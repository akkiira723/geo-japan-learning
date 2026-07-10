import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { normalizeName } from '../lib/normalize.ts';
import { loadSacDict, resolveMuniYomi, sacCurrentByName, type Yomi } from '../lib/yomi.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';

type Ring = [number, number][];
type PolyCoords = Ring[];
type MultiCoords = PolyCoords[];

interface MuniResult {
  pref: number;
  name: string;
  gun: string;
  page: string;
  imgs: { url: string; kind: 'design' | 'emblem'; desc: string }[];
}

interface OutItem {
  id: string;
  name: string;
  /** 自治体名のひらがな読み（「（旧）」サフィックスは含まない） */
  kana?: string;
  page: string;
  imgs: { url: string; kind: string; desc: string }[];
  /** 旧市町村へのフォールバック時のみ: 現在の自治体 */
  into?: string;
  /** into の各市区町村の読み */
  intoYomi?: Yomi[];
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

interface N03Props {
  N03_003: string | null;
  N03_004: string | null;
}

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

interface PrefGeoIndex {
  bySeirei: Map<string, MultiCoords>;
  byCity: Map<string, MultiCoords>;
  byGunTown: Map<string, MultiCoords>;
  byTown: Map<string, MultiCoords>;
}

const prefGeo = new Map<number, PrefGeoIndex>();

async function loadPrefGeo(pref: number): Promise<PrefGeoIndex> {
  let idx = prefGeo.get(pref);
  if (idx) return idx;
  const pp = String(pref).padStart(2, '0');
  const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
  idx = { bySeirei: new Map(), byCity: new Map(), byGunTown: new Map(), byTown: new Map() };
  const add = (m: Map<string, MultiCoords>, k: string, coords: MultiCoords) => {
    m.set(k, (m.get(k) ?? []).concat(coords));
  };
  for (const f of gj.features as Feature<Polygon | MultiPolygon, N03Props>[]) {
    const g3raw = f.properties.N03_003;
    const g3 = g3raw && !/支庁$|振興局$/.test(g3raw) ? normalizeName(g3raw) : null;
    const g4 = f.properties.N03_004 ? normalizeName(f.properties.N03_004) : null;
    if (!g4) continue;
    const coords = toMulti(f.geometry);
    if (g3 && g3.endsWith('郡')) {
      add(idx.byGunTown, g3 + g4, coords);
      add(idx.byTown, g4, coords);
    } else if (g3) {
      add(idx.bySeirei, g3, coords); // 政令市全体
      add(idx.byCity, g3 + g4, coords); // 「仙台市青葉区」
      add(idx.byTown, g4, coords); // 「青葉区」
    } else {
      add(idx.byCity, g4, coords);
      add(idx.byTown, g4, coords);
    }
  }
  prefGeo.set(pref, idx);
  return idx;
}

interface LegacyTown {
  n: string;
  kana?: string;
  into: string;
  intoYomi?: Yomi[];
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

const legacyCache = new Map<number, LegacyTown[]>();
async function loadLegacy(pref: number): Promise<LegacyTown[]> {
  let t = legacyCache.get(pref);
  if (!t) {
    const pp = String(pref).padStart(2, '0');
    t = JSON.parse(await readFile(`public/data/legacy/pref-${pp}.json`, 'utf8')).towns;
    legacyCache.set(pref, t!);
  }
  return t!;
}

async function main() {
  const overrides: Record<string, string | null> = JSON.parse(
    await readFile('scripts/overrides/manhole-fixes.json', 'utf8'),
  );
  await mkdir('public/data/manholes', { recursive: true });

  // 読み辞書（e-Stat SAC）: 現行自治体に名寄せできた項目の読みを引く。
  // 政令市の「市+区」複合名は連結、それ以外の未解決は muni-yomi.json へ
  const sacDict = await loadSacDict();
  const muniYomiOverride: Record<string, string> = JSON.parse(
    await readFile('scripts/overrides/muni-yomi.json', 'utf8'),
  );
  const unresolvedYomi = new Set<string>();
  const muniKanaOf = (pref: number, name: string): string | undefined => {
    const ov = muniYomiOverride[`${pref}|${name}`];
    if (ov) return ov;
    const direct = resolveMuniYomi(sacDict, pref, name);
    if (direct) return direct.k;
    const m = name.match(/^(.+?市)(.+区)$/);
    if (m) {
      const c = sacCurrentByName(sacDict, pref, m[1]);
      const w = sacCurrentByName(sacDict, pref, m[2]);
      if (c && w) return c.kana + w.kana;
    }
    unresolvedYomi.add(`  "${pref}|${name}": ""`);
    return undefined;
  };

  const unresolved: string[] = [];
  let total = 0, totalImgs = 0, legacyCount = 0;
  const prefCounts: Record<string, number> = {};

  for (let pref = 1; pref <= 47; pref++) {
    const pp = String(pref).padStart(2, '0');
    const resultPath = `data-cache/manho/result/pref-${pp}.json`;
    const items: OutItem[] = [];
    if (existsSync(resultPath)) {
      const munis: MuniResult[] = JSON.parse(await readFile(resultPath, 'utf8'));
      const geo = await loadPrefGeo(pref);
      for (const m of munis) {
        // 北海道インデックスの「あ 愛別町」のようなかな見出し混入を除去
        const cleanName = m.name.replace(/^[ぁ-んァ-ヶ]\s+/, '');
        const key = `${PREFECTURES[pref]}|${cleanName}`;
        let name = cleanName;
        if (key in overrides) {
          const o = overrides[key];
          if (o === null) continue;
          name = o;
        }
        const t = normalizeName(name);
        const gunT = normalizeName(m.gun ?? '');
        // 現行自治体に名寄せ
        const coords =
          geo.byCity.get(t) ??
          geo.bySeirei.get(t) ??
          (gunT ? geo.byGunTown.get(gunT + t) : undefined) ??
          geo.byTown.get(t);
        let out: OutItem | null = null;
        if (coords) {
          const merged = round5(coords);
          const bbox = bboxOf(merged);
          out = {
            id: createHash('sha1').update(m.page).digest('hex').slice(0, 10),
            name,
            kana: muniKanaOf(pref, name),
            page: m.page,
            imgs: m.imgs.map((i) => ({ url: i.url, kind: i.kind, desc: i.desc })),
            point: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
            bbox,
            geom: { type: 'MultiPolygon', coordinates: merged },
          };
        } else {
          // 旧市町村にフォールバック
          const legacy = (await loadLegacy(pref)).find((l) => normalizeName(l.n) === t);
          if (legacy) {
            legacyCount++;
            out = {
              id: createHash('sha1').update(m.page).digest('hex').slice(0, 10),
              name: `${name}（旧）`,
              kana: legacy.kana,
              page: m.page,
              imgs: m.imgs.map((i) => ({ url: i.url, kind: i.kind, desc: i.desc })),
              into: legacy.into,
              intoYomi: legacy.intoYomi,
              point: [
                (legacy.bbox[1] + legacy.bbox[3]) / 2,
                (legacy.bbox[0] + legacy.bbox[2]) / 2,
              ],
              bbox: legacy.bbox,
              geom:
                legacy.geom.type === 'Polygon'
                  ? { type: 'MultiPolygon', coordinates: [legacy.geom.coordinates] as MultiCoords }
                  : (legacy.geom as MultiPolygon),
            };
          } else {
            unresolved.push(`${pref} ${key}`);
          }
        }
        if (out) {
          items.push(out);
          totalImgs += out.imgs.length;
        }
      }
    }
    // 同名の複数ページ（横浜市デザイン１/２など）は1自治体にマージ
    const byName = new Map<string, OutItem>();
    for (const it of items) {
      const cur = byName.get(it.name);
      if (cur) {
        for (const img of it.imgs) {
          if (!cur.imgs.some((x) => x.url === img.url)) cur.imgs.push(img);
        }
      } else {
        byName.set(it.name, it);
      }
    }
    const merged = [...byName.values()];
    items.length = 0;
    items.push(...merged);

    prefCounts[pref] = items.length;
    total += items.length;
    await writeFile(
      `public/data/manholes/pref-${pp}.json`,
      JSON.stringify({ pref, items }),
      'utf8',
    );
  }

  if (unresolvedYomi.size > 0) {
    console.error(`✗ 読み仮名が解決できない自治体が ${unresolvedYomi.size} 件あります。`);
    console.error('  scripts/overrides/muni-yomi.json に以下のエントリを追記して再実行してください（値はひらがな読み）:');
    console.error([...unresolvedYomi].join('\n'));
    process.exit(1);
  }

  await writeFile(
    'public/data/manholes/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      totalImgs,
      legacyCount,
      unresolvedCount: unresolved.length,
      source:
        '日本マンホール蓋学会 (we-love-manho.com) — 画像は同サイトから直接読み込み（再配布なし） + 読み仮名: e-Stat 統計LOD 標準地域コード',
    }),
    'utf8',
  );

  console.log(`✓ ${total} 自治体 / ${totalImgs} 枚（うち旧市町村扱い ${legacyCount}）`);
  if (unresolved.length > 0) {
    console.log(`⚠ 名寄せ未解決 ${unresolved.length} 件（スキップ済み・overrides/manhole-fixes.json で解決可能）:`);
    unresolved.slice(0, 40).forEach((u) => console.log('  ' + u));
    if (unresolved.length > 40) console.log(`  ...ほか ${unresolved.length - 40} 件`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
