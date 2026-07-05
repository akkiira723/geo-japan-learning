import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { feature } from 'topojson-client';
import type { MultiPolygon, Polygon, Feature, FeatureCollection } from 'geojson';
import type { Topology, GeometryCollection } from 'topojson-specification';
import { parseCsvRecords } from '../lib/csv.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';

interface N03Props {
  N03_001: string; // 都道府県
  N03_003: string | null; // 郡・政令市
  N03_004: string; // 市区町村名（接尾辞込み）
  N03_007: string; // JISコード5桁
  id: string; // gci:XXXXXAYYYY
}

interface OutTown {
  id: string;
  n: string; // 表示名（例: 広島町）
  gun: string; // 郡・支庁など（例: 札幌郡）
  point: [number, number]; // [lat, lng]
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

const prefCodeByName = new Map(Object.entries(PREFECTURES).map(([c, n]) => [n, Number(c)]));

type Ring = [number, number][];

function roundGeom<G extends Polygon | MultiPolygon>(geom: G): G {
  const roundRing = (ring: Ring): Ring => {
    const out: Ring = [];
    for (const [x, y] of ring) {
      const p: [number, number] = [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
      const prev = out[out.length - 1];
      if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
    }
    return out;
  };
  if (geom.type === 'Polygon') {
    return { ...geom, coordinates: (geom.coordinates as Ring[]).map(roundRing) };
  }
  return { ...geom, coordinates: (geom.coordinates as Ring[][]).map((p) => p.map(roundRing)) };
}

function bboxOf(geom: Polygon | MultiPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const rings: Ring[] =
    geom.type === 'Polygon' ? (geom.coordinates as Ring[]) : (geom.coordinates as Ring[][]).flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (y < s) s = y;
      if (x > e) e = x;
      if (y > n) n = y;
    }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(w), r(s), r(e), r(n)];
}

async function main() {
  const overrides: { exclude: string[] } = JSON.parse(
    await readFile('scripts/overrides/legacy-fixes.json', 'utf8'),
  );

  // 1. スナップショット別の存在 JIS コード集合
  const jsonList = await readFile('data-cache/raw/geoshape-json-list.csv', 'utf8');
  const codesAt = (date: string): Map<string, string> => {
    // JIS5桁 → gci ID
    const map = new Map<string, string>();
    const re = new RegExp(`/geojson/${date}/\\d{2}/(\\d{5})(A\\d{4})\\.geojson`, 'g');
    for (const m of jsonList.matchAll(re)) map.set(m[1], `${m[1]}${m[2]}`);
    return map;
  };
  const at2023 = codesAt('20230101');
  console.log(`2023年時点: ${at2023.size} 自治体`);

  // 2. 現存自治体の (都道府県, 基底名) 集合 — 市制施行・単独改称の除外用
  const idRows = parseCsvRecords(await readFile('data-cache/raw/geoshape_city_id.csv', 'utf8'));
  const idInfo = new Map(idRows.map((r) => [r.geoshape_city_id, r]));
  const currentNames = new Map<string, Set<string>>();
  for (const gci of at2023.values()) {
    const row = idInfo.get(gci);
    if (!row) continue;
    const suffix = row['接尾辞'][0] ?? '';
    if (suffix === '区') continue; // 区は後継とみなさない（大宮市→大宮区 等は出題したい）
    const key = `${row['都道府県名']}|${row['市区町村名']}`;
    let set = currentNames.get(key);
    if (!set) currentNames.set(key, (set = new Set()));
    set.add(suffix);
  }
  // 「昇格または同名合併」のみ後継とみなす: 村→町→市 の同格以上に同名が現存する場合
  const RANK: Record<string, number> = { 村: 0, 町: 1, 市: 2 };
  const hasSuccessor = (pref: string, base: string, suffix: string): boolean => {
    const set = currentNames.get(`${pref}|${base}`);
    if (!set) return false;
    return [...set].some((s) => (RANK[s] ?? -1) >= (RANK[suffix] ?? 99));
  };

  // 3. TopoJSON から消滅市町村を抽出（2000年優先、1995年版で1995〜2000年消滅分を補完）
  const snapshots = ['20001001', '19951001'];
  const features: Feature<Polygon | MultiPolygon, N03Props>[] = [];
  const seenCode = new Set<string>();
  for (const snap of snapshots) {
    const topo = JSON.parse(
      await readFile(`data-cache/geo/legacy/jp_city_${snap}.c.topojson`, 'utf8'),
    ) as Topology<{ city: GeometryCollection<N03Props> }>;
    const fc = feature(topo, topo.objects.city) as FeatureCollection<Polygon | MultiPolygon, N03Props>;
    let added = 0;
    for (const f of fc.features as Feature<Polygon | MultiPolygon, N03Props>[]) {
      const code5 = f.properties.N03_007;
      if (!code5 || seenCode.has(code5)) continue;
      seenCode.add(code5);
      features.push(f);
      added++;
    }
    console.log(`${snap}: ${added} 件追加（累計 ${features.length}）`);
  }

  const byPref = new Map<number, OutTown[]>();
  let excluded = { ward: 0, surviving: 0, promoted: 0, manual: 0, noGeom: 0 };

  for (const f of features) {
    const p = f.properties;
    const code5 = p.N03_007;
    const name = p.N03_004;
    if (!code5 || !name) continue;
    if (at2023.has(code5)) { excluded.surviving++; continue; } // 現存
    if (name.endsWith('区')) { excluded.ward++; continue; }
    const prefCd = prefCodeByName.get(p.N03_001);
    if (!prefCd) continue;
    const base = name.replace(/[市町村]$/, '');
    if (hasSuccessor(p.N03_001, base, name.slice(-1))) { excluded.promoted++; continue; } // 同名で現存（昇格・同名合併）
    if (overrides.exclude.includes(p.id)) { excluded.manual++; continue; }
    if (!f.geometry) { excluded.noGeom++; continue; }

    const geom = roundGeom(f.geometry);
    const bbox = bboxOf(geom);
    const town: OutTown = {
      id: p.id,
      n: name,
      gun: p.N03_003 ?? '',
      point: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
      bbox,
      geom,
    };
    const arr = byPref.get(prefCd);
    if (arr) arr.push(town);
    else byPref.set(prefCd, [town]);
  }

  await mkdir('public/data/legacy', { recursive: true });
  let total = 0;
  const nameCount = new Map<string, number>();
  for (let pref = 1; pref <= 47; pref++) {
    const towns = (byPref.get(pref) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    total += towns.length;
    for (const t of towns) nameCount.set(t.n, (nameCount.get(t.n) ?? 0) + 1);
    await writeFile(
      `public/data/legacy/pref-${String(pref).padStart(2, '0')}.json`,
      JSON.stringify({ pref, towns }),
      'utf8',
    );
  }
  const dupes = [...nameCount.entries()].filter(([, c]) => c > 1);

  await writeFile(
    'public/data/legacy/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      duplicateNameCount: dupes.length,
      source:
        '『歴史的行政区域データセットβ版』（CODH作成） doi:10.20676/00000447 (CC BY 4.0) 1995/2000年時点スナップショット',
    }),
    'utf8',
  );

  console.log(`✓ 旧市町村 ${total} 件を47チャンクに出力`);
  console.log(
    `除外: 現存 ${excluded.surviving} / 区 ${excluded.ward} / 同名現存(昇格等) ${excluded.promoted} / 手動 ${excluded.manual} / ジオメトリなし ${excluded.noGeom}`,
  );
  console.log(
    `同名グループ: ${dupes.length} 件（例: ${dupes.sort((a, b) => b[1] - a[1]).slice(0, 8).map(([n, c]) => `${n}×${c}`).join(', ')}）`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
