import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon } from 'geojson';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { joinWays, lineLengthKm, type OsmWay } from '../lib/join-ways.ts';
import { loadRouteFixes, routeNumberOf, expectedRouteNumbers, type OsmRelation } from '../lib/national-route.ts';
import { roundLine4, simplifyLine, type Line } from '../lib/simplify.ts';

/**
 * data-cache/routes/{members,geoms}.json から国道番号クイズ用の
 * 路線別線形 JSON（public/data/routes/）を生成する。
 * 番号帯フィルタのチャンクと 1:1 になるよう 3 ファイルに分割する。
 */

/** DP 許容誤差（度）。約100m。最小正解半径 3km に対し誤差3%で判定・表示とも実用上無害 */
const TOLERANCE = 1e-3;
/** サニティ: 国道総延長（実延長約5.6万km。バイパス・重複区間の二重計上があるので上限は緩め） */
const MIN_TOTAL_KM = 45_000;
const MAX_TOTAL_KM = 100_000;
/** チャンクごとのサイズ上限。超えたら TOLERANCE を 2e-3 へ上げて再実行する */
const MAX_CHUNK_KB = 800;
/** 都道府県判定のサンプリング間隔 */
const PREF_SAMPLE_KM = 15;

const SOURCE = 'OpenStreetMap via Overpass API (ODbL, © OpenStreetMap contributors)';

const BANDS = [
  { key: 'two', min: 1, max: 58 },
  { key: 'three-low', min: 101, max: 299 },
  { key: 'three-high', min: 300, max: 507 },
] as const;

interface RouteItem {
  n: number;
  prefs: number[];
  point: [number, number]; // [lat, lng] 最長チェーンの中間点
  bbox: [number, number, number, number]; // [w, s, e, n]
  geom: { type: 'MultiLineString'; coordinates: Line[] };
}

interface PrefGeo {
  pref: number;
  bbox: [number, number, number, number];
  features: { bbox: [number, number, number, number]; geometry: Polygon | MultiPolygon }[];
}

function geomBbox(geom: Polygon | MultiPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

async function loadPrefGeos(): Promise<PrefGeo[]> {
  const out: PrefGeo[] = [];
  for (let pref = 1; pref <= 47; pref++) {
    const pp = String(pref).padStart(2, '0');
    const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
    const features = gj.features.map((f: { geometry: Polygon | MultiPolygon }) => ({
      bbox: geomBbox(f.geometry),
      geometry: f.geometry,
    }));
    const bbox: [number, number, number, number] = [
      Math.min(...features.map((f: { bbox: number[] }) => f.bbox[0])),
      Math.min(...features.map((f: { bbox: number[] }) => f.bbox[1])),
      Math.max(...features.map((f: { bbox: number[] }) => f.bbox[2])),
      Math.max(...features.map((f: { bbox: number[] }) => f.bbox[3])),
    ];
    out.push({ pref, bbox, features });
  }
  return out;
}

const inBbox = (lon: number, lat: number, b: [number, number, number, number]) =>
  lon >= b[0] && lat >= b[1] && lon <= b[2] && lat <= b[3];

/** 県 bbox プレフィルタ → point-in-polygon。海上サンプル点（橋・フェリー跡）はどの県にも属さず null */
function prefAt(lon: number, lat: number, prefGeos: PrefGeo[]): number | null {
  for (const pg of prefGeos) {
    if (!inBbox(lon, lat, pg.bbox)) continue;
    for (const feat of pg.features) {
      if (!inBbox(lon, lat, feat.bbox)) continue;
      if (booleanPointInPolygon([lon, lat], feat.geometry)) return pg.pref;
    }
  }
  return null;
}

/** 線に沿って端点＋約 PREF_SAMPLE_KM おきにサンプリングした通過都道府県（初出順） */
function routePrefs(chains: Line[], prefGeos: PrefGeo[]): number[] {
  const prefs: number[] = [];
  const push = (lon: number, lat: number) => {
    const p = prefAt(lon, lat, prefGeos);
    if (p !== null && !prefs.includes(p)) prefs.push(p);
  };
  for (const chain of chains) {
    push(chain[0][0], chain[0][1]);
    let sinceSample = 0;
    for (let i = 1; i < chain.length; i++) {
      sinceSample += lineLengthKm([chain[i - 1], chain[i]]);
      if (sinceSample >= PREF_SAMPLE_KM) {
        push(chain[i][0], chain[i][1]);
        sinceSample = 0;
      }
    }
    push(chain[chain.length - 1][0], chain[chain.length - 1][1]);
  }
  return prefs;
}

/** リレーションを relation メンバー含めて再帰的に辿り、way ID を集める */
function collectWayIds(
  relId: number,
  byRelId: Map<number, OsmRelation>,
  visited: Set<number>,
  out: Set<number>,
  unresolved: Set<number>,
): void {
  if (visited.has(relId)) return;
  visited.add(relId);
  const rel = byRelId.get(relId);
  if (!rel) {
    unresolved.add(relId);
    return;
  }
  for (const m of rel.members ?? []) {
    if (m.type === 'way') out.add(m.ref);
    else if (m.type === 'relation') collectWayIds(m.ref, byRelId, visited, out, unresolved);
  }
}

function linesBbox(chains: Line[]): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const chain of chains) {
    for (const [x, y] of chain) {
      if (x < w) w = x;
      if (x > e) e = x;
      if (y < s) s = y;
      if (y > n) n = y;
    }
  }
  return [w, s, e, n];
}

async function main() {
  const members = JSON.parse(await readFile('data-cache/routes/members.json', 'utf8'));
  const geoms = JSON.parse(await readFile('data-cache/routes/geoms.json', 'utf8'));
  const fixes = await loadRouteFixes();
  const excluded = new Set(Object.keys(fixes.exclude).map((k) => Number(k.replace(/^r/, ''))));

  const byRelId = new Map<number, OsmRelation>();
  for (const el of members.elements as OsmRelation[]) byRelId.set(el.id, el);

  // 番号 → リレーション ID 群（選別ロジックは fetch と同一 + overrides）
  const relsByNumber = new Map<number, number[]>();
  const addRel = (n: number, id: number) => {
    if (excluded.has(id)) return;
    const list = relsByNumber.get(n);
    if (list) list.push(id);
    else relsByNumber.set(n, [id]);
  };
  for (const rel of byRelId.values()) {
    const n = routeNumberOf(rel.tags);
    if (n !== null) addRel(n, rel.id);
  }
  for (const [no, ids] of Object.entries(fixes.addRelations)) {
    for (const id of ids) addRel(Number(no), id);
  }

  const byWayId = new Map<number, OsmWay>();
  for (const el of geoms.elements as OsmWay[]) {
    if (el.type === 'way' && Array.isArray(el.geometry) && el.geometry.length >= 2) {
      byWayId.set(el.id, el);
    }
  }

  const prefGeos = await loadPrefGeos();
  const items: RouteItem[] = [];
  let totalKm = 0;
  let totalChains = 0;
  let rawPoints = 0;
  let outPoints = 0;
  let ferryDropped = 0;
  const unresolvedRels = new Set<number>();
  const noPrefs: number[] = [];

  for (const [n, relIds] of [...relsByNumber.entries()].sort((a, b) => a[0] - b[0])) {
    const wayIds = new Set<number>();
    const visited = new Set<number>();
    for (const relId of relIds) collectWayIds(relId, byRelId, visited, wayIds, unresolvedRels);
    const ways: OsmWay[] = [];
    for (const id of wayIds) {
      const w = byWayId.get(id);
      if (w) ways.push(w);
      else ferryDropped++; // ["highway"] フィルタ落ち（フェリー等）または取得漏れ
    }
    if (ways.length === 0) continue;

    // 最長チェーンが先頭に来るよう長さ降順に（point・prefs の初出順の基準）
    const chains = joinWays(ways)
      .map((c) => ({ coords: c, km: lineLengthKm(c) }))
      .sort((a, b) => b.km - a.km);
    rawPoints += chains.reduce((s, c) => s + c.coords.length, 0);
    const simplified = chains
      .map((c) => roundLine4(simplifyLine(c.coords, TOLERANCE)))
      .filter((c) => c.length >= 2);
    if (simplified.length === 0) continue;
    outPoints += simplified.reduce((s, c) => s + c.length, 0);
    totalKm += simplified.reduce((s, c) => s + lineLengthKm(c), 0);
    totalChains += simplified.length;

    const longest = simplified[0];
    const mid = longest[Math.floor(longest.length / 2)];
    const prefs = routePrefs(simplified, prefGeos);
    if (prefs.length === 0) noPrefs.push(n);
    items.push({
      n,
      prefs,
      point: [mid[1], mid[0]],
      bbox: linesBbox(simplified),
      geom: { type: 'MultiLineString', coordinates: simplified },
    });
  }

  // 全459路線が揃っているかの突合
  const expected = expectedRouteNumbers();
  const missing = [...expected].filter((n) => !items.some((i) => i.n === n)).sort((a, b) => a - b);
  const unexpected = items.filter((i) => !expected.has(i.n)).map((i) => i.n);
  console.log(
    `路線 ${items.length}/${expected.size} / チェーン ${totalChains} 本 / 点数 ${rawPoints} → ${outPoints}（tol=${TOLERANCE}）/ 総延長 ${Math.round(totalKm)} km / way欠落 ${ferryDropped}（フェリー等）`,
  );
  if (unresolvedRels.size > 0) {
    console.warn(`⚠ 未取得のネストリレーション ${unresolvedRels.size} 件: ${[...unresolvedRels].join(', ')}`);
  }

  const errors: string[] = [];
  if (missing.length > 0) {
    errors.push(`未解決の路線番号 ${missing.length} 件: ${missing.join(', ')}\n  → overrides/route-fixes.json の addRelations に該当リレーションを追記して再実行`);
  }
  if (unexpected.length > 0) {
    errors.push(`欠番のはずの番号が出力に含まれる: ${unexpected.join(', ')}（選別ロジックか OSM タグの誤り）`);
  }
  if (noPrefs.length > 0) {
    errors.push(`通過都道府県が判定できない路線: ${noPrefs.join(', ')}`);
  }
  if (totalKm < MIN_TOTAL_KM || totalKm > MAX_TOTAL_KM) {
    errors.push(`総延長 ${Math.round(totalKm)} km が想定範囲 ${MIN_TOTAL_KM}〜${MAX_TOTAL_KM} km を外れている（取得漏れ/旧道混入の疑い）`);
  }

  await mkdir('public/data/routes', { recursive: true });
  const sizes: string[] = [];
  for (const band of BANDS) {
    const bandItems = items.filter((i) => i.n >= band.min && i.n <= band.max);
    const json = JSON.stringify({ band: band.key, source: SOURCE, items: bandItems });
    const kb = json.length / 1000;
    sizes.push(`${band.key}: ${bandItems.length} 路線 / ${Math.round(kb)} KB`);
    if (kb > MAX_CHUNK_KB) {
      errors.push(`${band.key}.json が ${Math.round(kb)} KB > ${MAX_CHUNK_KB} KB。TOLERANCE を 2e-3 へ上げて再実行すること`);
      continue;
    }
    await writeFile(`public/data/routes/${band.key}.json`, json, 'utf8');
  }
  console.log(sizes.join(' / '));

  if (errors.length > 0) {
    for (const e of errors) console.error(`✗ ${e}`);
    process.exit(1);
  }

  const index = {
    version: 1,
    generatedAt: new Date().toISOString().slice(0, 10),
    total: items.length,
    counts: Object.fromEntries(
      BANDS.map((b) => [b.key, items.filter((i) => i.n >= b.min && i.n <= b.max).length]),
    ),
    source: SOURCE,
  };
  await writeFile('public/data/routes/index.json', JSON.stringify(index, null, 2) + '\n', 'utf8');
  console.log('✓ public/data/routes/{two,three-low,three-high,index}.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
