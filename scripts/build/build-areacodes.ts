import { mkdir, readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { normalizeName } from '../lib/normalize.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';

type Ring = [number, number][];
type PolyCoords = Ring[];
type MultiCoords = PolyCoords[];

interface RawAreaCode {
  code: string;
  pref: string;
  tokens: string[];
}

interface N03Props {
  N03_001: string;
  N03_003: string | null;
  N03_004: string | null;
  N03_007: string;
}

interface OutArea {
  code: string;
  munis: string[];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

const prefCodeByName = new Map(Object.entries(PREFECTURES).map(([c, n]) => [n, Number(c)]));

function toMulti(geom: Polygon | MultiPolygon): MultiCoords {
  return geom.type === 'Polygon' ? [geom.coordinates as PolyCoords] : (geom.coordinates as MultiCoords);
}

function round5(coords: MultiCoords): MultiCoords {
  return coords.map((poly) =>
    poly.map((ring) => {
      const out: Ring = [];
      for (const [x, y] of ring) {
        const p: [number, number] = [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
      }
      return out;
    }),
  );
}

function bboxOf(coords: MultiCoords): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of coords)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (y < s) s = y;
        if (x > e) e = x;
        if (y > n) n = y;
      }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(w), r(s), r(e), r(n)];
}

interface PrefIndex {
  features: Feature<Polygon | MultiPolygon, N03Props>[];
  byCity: Map<string, number[]>;
  bySeirei: Map<string, number[]>;
  byGun: Map<string, number[]>;
  byGunTown: Map<string, number[]>;
  byTown: Map<string, number[]>;
}

const prefIndexes = new Map<number, PrefIndex>();

async function loadPref(prefCd: number): Promise<PrefIndex> {
  let idx = prefIndexes.get(prefCd);
  if (idx) return idx;
  const pp = String(prefCd).padStart(2, '0');
  const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
  const features = gj.features as Feature<Polygon | MultiPolygon, N03Props>[];
  idx = {
    features,
    byCity: new Map(),
    bySeirei: new Map(),
    byGun: new Map(),
    byGunTown: new Map(),
    byTown: new Map(),
  };
  const push = (m: Map<string, number[]>, k: string, i: number) => {
    const a = m.get(k);
    if (a) a.push(i);
    else m.set(k, [i]);
  };
  features.forEach((f, i) => {
    const g3raw = f.properties.N03_003;
    // 支庁・振興局は郡・政令市ではないので無視する
    const g3 = g3raw && !/支庁$|振興局$/.test(g3raw) ? normalizeName(g3raw) : null;
    const g4 = f.properties.N03_004 ? normalizeName(f.properties.N03_004) : null;
    if (!g4) return;
    if (g3 && g3.endsWith('郡')) {
      push(idx!.byGun, g3, i);
      push(idx!.byGunTown, g3 + g4, i);
      push(idx!.byTown, g4, i);
    } else if (g3) {
      // 政令指定都市: N03_003=市名, N03_004=区名
      push(idx!.bySeirei, g3, i);
      push(idx!.byCity, g3 + g4, i); // 「札幌市中央区」形式
    } else {
      push(idx!.byCity, g4, i);
      push(idx!.byTown, g4, i);
    }
  });
  prefIndexes.set(prefCd, idx);
  return idx;
}

function expandToken(idx: PrefIndex, token: string): number[] | null {
  const t = normalizeName(token);
  if (t === '東京23区') {
    const out: number[] = [];
    idx.features.forEach((f, i) => {
      const cd = Number(f.properties.N03_007);
      if (cd >= 13101 && cd <= 13123) out.push(i);
    });
    return out.length > 0 ? out : null;
  }
  if (idx.bySeirei.has(t)) return idx.bySeirei.get(t)!;
  if (idx.byCity.has(t)) return idx.byCity.get(t)!;
  if (idx.byGun.has(t)) return idx.byGun.get(t)!;
  if (idx.byGunTown.has(t)) return idx.byGunTown.get(t)!;
  // 「◯◯郡△△町」形式: 郡名部分を前方一致で剥がす
  for (const gun of idx.byGun.keys()) {
    if (t.startsWith(gun)) {
      const rest = t.slice(gun.length);
      if (idx.byGunTown.has(gun + rest)) return idx.byGunTown.get(gun + rest)!;
    }
  }
  if (idx.byTown.has(t)) return idx.byTown.get(t)!;
  return null;
}

async function main() {
  const rows: RawAreaCode[] = JSON.parse(await readFile('data-cache/raw/areacodes.json', 'utf8'));
  const overrides: Record<string, string[] | null> = JSON.parse(
    await readFile('scripts/overrides/areacode-muni-fixes.json', 'utf8'),
  );
  const usedOverrides = new Set<string>();

  const unresolved: string[] = [];
  // バケット: `${code}|${prefCd}` → feature idx 集合と表示用トークン
  const buckets = new Map<string, { code: string; prefCd: number; featIdx: Set<number>; munis: string[] }>();

  const addToBucket = (code: string, prefCd: number, idxs: number[], displayToken?: string) => {
    const key = `${code}|${prefCd}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { code, prefCd, featIdx: new Set(), munis: [] }));
    idxs.forEach((i) => b!.featIdx.add(i));
    if (displayToken && !b.munis.includes(displayToken)) b.munis.push(displayToken);
  };

  for (const row of rows) {
    const rowPrefCd = prefCodeByName.get(row.pref);
    if (!rowPrefCd) {
      unresolved.push(`(都道府県不明) ${row.pref}`);
      continue;
    }
    const rowIdx = await loadPref(rowPrefCd);

    for (const token of row.tokens) {
      const key = `${row.pref}|${token}`;
      let resolved: string[] | null = [token];
      if (key in overrides) {
        resolved = overrides[key];
        usedOverrides.add(key);
      }
      if (resolved === null) continue; // 明示的に無視

      for (const tk of resolved) {
        // 「他県名/自治体名」形式の県またぎ指定
        const cross = tk.match(/^(.+?[都道府県])\/(.+)$/);
        const targetPrefCd = cross ? prefCodeByName.get(cross[1]) : rowPrefCd;
        const muniToken = cross ? cross[2] : tk;
        if (!targetPrefCd) {
          unresolved.push(`${row.code} ${key} (override先の都道府県不明: ${tk})`);
          continue;
        }
        const idx = targetPrefCd === rowPrefCd ? rowIdx : await loadPref(targetPrefCd);
        const found = expandToken(idx, muniToken);
        if (found) addToBucket(row.code, targetPrefCd, found, token);
        else unresolved.push(`${row.code} ${key}` + (tk !== token ? ` (override→${tk})` : ''));
      }
    }

    if (![...buckets.keys()].some((k) => k.startsWith(`${row.code}|`))) {
      unresolved.push(`${row.code} ${row.pref}| (該当ポリゴンなし)`);
    }
  }

  const unusedOverrides = Object.keys(overrides).filter((k) => !usedOverrides.has(k));
  if (unusedOverrides.length > 0) {
    console.warn(`⚠ 使われていない override: ${unusedOverrides.join(', ')}`);
  }

  if (unresolved.length > 0) {
    console.error(`\n✗ 名寄せ未解決 ${unresolved.length} 件:`);
    unresolved.forEach((u) => console.error('  ' + u));
    console.error('\nscripts/overrides/areacode-muni-fixes.json に追記してください。');
    process.exit(1);
  }

  // union してチャンク出力
  const outByPref = new Map<number, OutArea[]>();
  const codePrefs = new Map<string, Set<number>>();
  for (const b of buckets.values()) {
    const idx = await loadPref(b.prefCd);
    const multis: MultiCoords[] = [...b.featIdx].map((i) => toMulti(idx.features[i].geometry));
    let merged: MultiCoords;
    try {
      merged = polygonClipping.union(
        multis[0] as never,
        ...(multis.slice(1) as never[]),
      ) as MultiCoords;
    } catch {
      console.warn(`⚠ union 失敗: ${b.code} pref${b.prefCd} → 連結にフォールバック`);
      merged = multis.flat();
    }
    merged = round5(merged);

    const area: OutArea = {
      code: b.code,
      munis: b.munis,
      bbox: bboxOf(merged),
      geom: { type: 'MultiPolygon', coordinates: merged },
    };
    const arr = outByPref.get(b.prefCd);
    if (arr) arr.push(area);
    else outByPref.set(b.prefCd, [area]);
    let cp = codePrefs.get(b.code);
    if (!cp) codePrefs.set(b.code, (cp = new Set()));
    cp.add(b.prefCd);
  }

  await mkdir('public/data/areacodes', { recursive: true });
  let total = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const areas = (outByPref.get(pref) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    total += areas.length;
    await writeFile(
      `public/data/areacodes/pref-${String(pref).padStart(2, '0')}.json`,
      JSON.stringify({ pref, areas }),
      'utf8',
    );
  }
  await writeFile(
    'public/data/areacodes/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      codeCount: codePrefs.size,
      crossPrefCodes: Object.fromEntries(
        [...codePrefs.entries()].filter(([, s]) => s.size > 1).map(([c, s]) => [c, [...s].sort((a, b) => a - b)]),
      ),
      source: 'good-luck-day.com 市外局番表 + 国土数値情報 N03 (japan-topography s0010)',
      note: '市区町村単位の近似。実際の番号区画(MA)境界とは一部異なる。',
    }),
    'utf8',
  );

  console.log(`✓ ${codePrefs.size} 局番 / ${total} エリア行を47チャンクに出力`);
  const cross = [...codePrefs.entries()].filter(([, s]) => s.size > 1);
  console.log(`県またぎ局番: ${cross.map(([c]) => c).join(', ') || 'なし'}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
