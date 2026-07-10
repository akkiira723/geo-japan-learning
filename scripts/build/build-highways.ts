import { mkdir, readFile, writeFile } from 'node:fs/promises';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiPolygon, Polygon } from 'geojson';
import { haversineKm } from '../../src/lib/judge.ts';
import {
  canonicalUrbanGateName,
  classifyJunctionKind,
  classifyServiceKind,
  clusterByProximity,
  facilityCore,
  facilityKanaCore,
  isExcludedName,
  isExpresswayRestArea,
  isUrbanExpressway,
  normalizeFacilityName,
  type HighwayKind,
} from '../lib/highway.ts';
import { kataToHira, type Yomi } from '../lib/yomi.ts';
import { normalizeName } from '../lib/normalize.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';
import type { HighwayYomiEntry } from '../fetch/fetch-highway-yomi.ts';

const CLUSTER_KM = 2; // 上下線・複数ランプの同名ノードを1施設とみなす距離

/** 出力チャンク（施設種別フィルタと 1:1 対応） */
type ChunkKind = 'ic' | 'jct' | 'sapa';

interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OsmWay {
  type: 'way';
  id: number;
  nodes: number[];
  tags?: Record<string, string>;
}
interface OsmService {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

interface Facility {
  osmKey: string; // n/w/r + OSM id
  name: string;
  kind: HighwayKind;
  lat: number;
  lon: number;
  roads: string[];
  urban: boolean;
  /** OSM の name:ja-Hira（あれば読みの第一ソース） */
  hira?: string;
}

interface OutFacility {
  id: string;
  n: string;
  k?: 'sa' | 'pa';
  /** 地名コアのふりがな（b は n の先頭部分、k はひらがな読み）。読みが取れない施設は省略 */
  y?: Yomi;
  lat: number;
  lon: number;
  r?: string[];
  u?: 1;
  pref: number;
}

interface Overrides {
  exclude: Record<string, string>; // osmKey → 除外理由メモ
  rename: Record<string, string>; // osmKey → 正しい施設名
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

/** 「銀座出口」のようなランプ自体の名前は道路名として使わない */
const isRampName = (n: string) => /(出入口|入口|出口|ランプ)$/.test(n);

/** 親 way から道路名を選ぶ。本線（非 _link）の name 優先 → 本線 ref → ランプの name */
function pickRoads(ways: OsmWay[]): string[] {
  const named = (list: OsmWay[]) =>
    [...new Set(list.map((w) => w.tags!.name!).filter((n) => !isRampName(n)))];
  const mainNames = named(ways.filter((w) => !w.tags?.highway?.endsWith('_link') && w.tags?.name));
  if (mainNames.length > 0) return mainNames;
  const mainRefs = ways.filter((w) => !w.tags?.highway?.endsWith('_link') && w.tags?.ref);
  if (mainRefs.length > 0) return [...new Set(mainRefs.map((w) => w.tags!.ref!))];
  return named(ways.filter((w) => w.tags?.name));
}

async function loadFacilities(overrides: Overrides): Promise<Facility[]> {
  const junctions: OsmNode[] = JSON.parse(
    await readFile('data-cache/highway/junctions.json', 'utf8'),
  ).elements;
  const ways: OsmWay[] = JSON.parse(await readFile('data-cache/highway/ways.json', 'utf8')).elements;
  const services: OsmService[] = JSON.parse(
    await readFile('data-cache/highway/services.json', 'utf8'),
  ).elements;

  const waysByNode = new Map<number, OsmWay[]>();
  for (const w of ways) {
    for (const nid of w.nodes) {
      const arr = waysByNode.get(nid);
      if (arr) arr.push(w);
      else waysByNode.set(nid, [w]);
    }
  }

  const out: Facility[] = [];
  let excluded = 0;
  for (const nd of junctions) {
    const osmKey = `n${nd.id}`;
    if (overrides.exclude[osmKey] !== undefined) continue;
    const raw = overrides.rename[osmKey] ?? nd.tags?.name;
    if (!raw || isExcludedName(raw)) {
      excluded++;
      continue;
    }
    let name = normalizeFacilityName(raw);
    const parents = waysByNode.get(nd.id) ?? [];
    const kind = classifyJunctionKind(name);
    const urban = parents.some((w) => isUrbanExpressway(w.tags ?? {}));
    // 首都高等はサフィックスの無い裸名称（「霞が関」）と「霞が関出入口」が混在するため揃える
    if (urban && kind === 'ic') name = canonicalUrbanGateName(name);
    out.push({
      osmKey,
      name,
      kind,
      lat: nd.lat,
      lon: nd.lon,
      roads: pickRoads(parents),
      urban,
      hira: nd.tags?.['name:ja-Hira'],
    });
  }

  for (const el of services) {
    const osmKey = `${el.type[0]}${el.id}`;
    if (overrides.exclude[osmKey] !== undefined) continue;
    const raw = overrides.rename[osmKey] ?? el.tags?.name;
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    // rest_area は道の駅・一般道の駐車場にも使われるため SA/PA 系名称だけを採用する
    if (!raw || lat === undefined || lon === undefined || isExcludedName(raw) || !isExpresswayRestArea(raw)) {
      excluded++;
      continue;
    }
    const name = normalizeFacilityName(raw);
    out.push({
      osmKey,
      name,
      kind: classifyServiceKind(name, el.tags?.highway === 'services' ? 'services' : 'rest_area'),
      lat,
      lon,
      roads: [],
      urban: isUrbanExpressway(el.tags ?? {}),
      hira: el.tags?.['name:ja-Hira'],
    });
  }

  console.log(
    `junction ${junctions.length} + services ${services.length} → 有効 ${out.length}（除外 ${excluded}）`,
  );
  return out;
}

const chunkOf = (f: Facility): ChunkKind => (f.kind === 'sa' || f.kind === 'pa' ? 'sapa' : f.kind);

/**
 * 親 way が取れず都市高速と判定できなかった裸名称（「銀座」）を、2km 以内に
 * 「銀座出入口」が存在する場合だけそちらへ名寄せする（遠隔の偶然の同名は触らない）
 */
function unifyBareGateNames(facilities: Facility[]): void {
  const gates = new Map<string, Facility[]>();
  for (const f of facilities) {
    if (chunkOf(f) !== 'ic' || !f.name.endsWith('出入口')) continue;
    const arr = gates.get(f.name);
    if (arr) arr.push(f);
    else gates.set(f.name, [f]);
  }
  for (const f of facilities) {
    if (chunkOf(f) !== 'ic' || /(IC|JCT|インター|ランプ|出入口|SA|PA)$/.test(f.name)) continue;
    const near = gates.get(`${f.name}出入口`)?.some(
      (g) => haversineKm({ lat: f.lat, lng: f.lon }, { lat: g.lat, lng: g.lon }) <= CLUSTER_KM,
    );
    if (near) f.name = `${f.name}出入口`;
  }
}

/** 「首都高速11号台場線・東京港連絡橋」と「首都高速11号台場線」のような包含系列は短い方だけ残す */
function dedupeRoads(roads: string[]): string[] {
  return roads.filter((r) => !roads.some((other) => other !== r && r.includes(other)));
}

/** 同名・同種別の近接ノード群を1施設にマージ */
function mergeFacilities(facilities: Facility[]): Facility[] {
  unifyBareGateNames(facilities);
  const byKey = new Map<string, Facility[]>();
  for (const f of facilities) {
    const key = `${chunkOf(f)}|${f.name}`;
    const arr = byKey.get(key);
    if (arr) arr.push(f);
    else byKey.set(key, [f]);
  }
  const merged: Facility[] = [];
  for (const group of byKey.values()) {
    for (const cluster of clusterByProximity(group, CLUSTER_KM)) {
      const lat = cluster.reduce((s, f) => s + f.lat, 0) / cluster.length;
      const lon = cluster.reduce((s, f) => s + f.lon, 0) / cluster.length;
      const roads = dedupeRoads([...new Set(cluster.flatMap((f) => f.roads))]).slice(0, 3);
      // id はクラスタ内の最小 OSM id（node 優先）で安定させる
      const rep = [...cluster].sort((a, b) => a.osmKey.localeCompare(b.osmKey, 'en', { numeric: true }))[0];
      merged.push({
        osmKey: rep.osmKey,
        name: rep.name,
        // sa/pa 混在クラスタ（junction 由来 vs services 由来）は sa 優先
        kind: cluster.some((f) => f.kind === 'sa') ? 'sa' : rep.kind,
        lat: round5(lat),
        lon: round5(lon),
        roads,
        urban: cluster.some((f) => f.urban),
        hira: cluster.map((f) => f.hira).find(Boolean),
      });
    }
  }
  return merged;
}

interface PrefGeo {
  pref: number;
  bbox: [number, number, number, number]; // west, south, east, north
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

function bboxDist(lon: number, lat: number, b: [number, number, number, number]): number {
  const dx = Math.max(b[0] - lon, 0, lon - b[2]);
  const dy = Math.max(b[1] - lat, 0, lat - b[3]);
  return Math.sqrt(dx * dx + dy * dy);
}

const inBbox = (lon: number, lat: number, b: [number, number, number, number], margin = 0) =>
  lon >= b[0] - margin && lat >= b[1] - margin && lon <= b[2] + margin && lat <= b[3] + margin;

/** ポリゴン外周の頂点までの最短距離（deg²）。海上施設の最寄り県判定用 */
function minVertexDist2(lon: number, lat: number, geom: Polygon | MultiPolygon): number {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  let min = Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      const d = (x - lon) ** 2 + (y - lat) ** 2;
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * 県 bbox プレフィルタ → point-in-polygon。海上（橋・埋立地・臨港道路）は最寄りの
 * ポリゴン頂点距離でフォールバック（bbox 距離だと伊豆諸島を含む東京都などに吸われる）
 */
function assignPref(f: Facility, prefGeos: PrefGeo[], fallbacks: string[]): number {
  for (const pg of prefGeos) {
    if (!inBbox(f.lon, f.lat, pg.bbox)) continue;
    for (const feat of pg.features) {
      if (!inBbox(f.lon, f.lat, feat.bbox)) continue;
      if (booleanPointInPolygon([f.lon, f.lat], feat.geometry)) return pg.pref;
    }
  }
  let best = 1;
  let bestDist = Infinity;
  for (const pg of prefGeos) {
    for (const feat of pg.features) {
      if (bboxDist(f.lon, f.lat, feat.bbox) ** 2 >= bestDist) continue;
      const d = minVertexDist2(f.lon, f.lat, feat.geometry);
      if (d < bestDist) {
        bestDist = d;
        best = pg.pref;
      }
    }
  }
  fallbacks.push(`${f.name} (${f.osmKey}) → pref ${best}`);
  return best;
}

function sanity(label: string, count: number, min: number, max: number, errors: string[]) {
  if (count < min || count > max) {
    errors.push(`${label}: ${count} 件（想定範囲 ${min}〜${max} 外）`);
  }
}

/**
 * 施設の読み解決: overrides/highway-yomi.json → OSM name:ja-Hira → Wikipedia 読み辞書。
 * 都市高速のランプ名や新設施設など辞書に無いものは読みなしのまま出力する
 * （欠落リストを表示するので override で漸進的に補完する運用）。
 */
function buildYomiResolver(
  wikiEntries: HighwayYomiEntry[],
  yomiOverride: Record<string, string>,
): (f: Facility, pref: number) => { yomi?: Yomi; miss?: string } {
  const byCore = new Map<string, HighwayYomiEntry[]>();
  for (const e of wikiEntries) {
    const key = normalizeName(e.core);
    const arr = byCore.get(key);
    if (arr) arr.push(e);
    else byCore.set(key, [e]);
  }
  return (f, pref) => {
    // 「横浜青葉IC/JCT」「名立谷浜SA(上り)、IC」のような複合表記は先頭の施設名で読みを引く。
    // ・は固有名にも使われるため、先頭部が施設サフィックスで終わる場合だけ複合とみなす
    const cleaned = f.name.replace(/[（(].*?[）)]/g, '').trim();
    const parts = cleaned.split(/[/／、;・]/);
    const isCompound =
      parts.length > 1 && /(IC|JCT|SA|PA|インターチェンジ|ジャンクション|サービスエリア|パーキングエリア|出入口|ランプ)$/.test(parts[0].trim());
    const b = facilityCore(isCompound ? parts[0].trim() : cleaned);
    const done = (k: string) => ({ yomi: { b, k } });
    const ov = yomiOverride[f.osmKey];
    if (ov) return done(ov);
    if (f.hira) {
      const k = facilityKanaCore(kataToHira(f.hira.normalize('NFKC').replace(/[（(].*?[）)]/g, '').trim()));
      if (k && /^[ぁ-んー・\s]+$/.test(k)) return done(k);
    }
    let candidates = byCore.get(normalizeName(b)) ?? [];
    if (candidates.length > 1) {
      const prefName = PREFECTURES[pref];
      const byPref = candidates.filter((c) => c.pref === prefName);
      if (byPref.length > 0) candidates = byPref;
    }
    if (candidates.length > 1 && f.roads.length > 0) {
      const byRoad = candidates.filter(
        (c) => c.road && f.roads.some((r) => r.includes(c.road!) || c.road!.includes(r)),
      );
      if (byRoad.length > 0) candidates = byRoad;
    }
    const kanas = [...new Set(candidates.map((c) => c.kana))];
    if (kanas.length === 1) return done(kanas[0]);
    return { miss: `${f.name} (${f.osmKey}, pref ${pref})${kanas.length > 1 ? ` 読み候補: ${kanas.join('/')}` : ''}` };
  };
}

async function main() {
  const overrides: Overrides = JSON.parse(
    await readFile('scripts/overrides/highway-fixes.json', 'utf8'),
  );
  const yomiOverride: Record<string, string> = JSON.parse(
    await readFile('scripts/overrides/highway-yomi.json', 'utf8'),
  );
  const wikiYomi: { entries: HighwayYomiEntry[] } = JSON.parse(
    await readFile('data-cache/yomi/wikipedia-highway.json', 'utf8'),
  );
  const resolveYomi = buildYomiResolver(wikiYomi.entries, yomiOverride);
  const facilities = mergeFacilities(await loadFacilities(overrides));
  const prefGeos = await loadPrefGeos();

  const chunks: Record<ChunkKind, OutFacility[]> = { ic: [], jct: [], sapa: [] };
  const fallbacks: string[] = [];
  const yomiMisses: string[] = [];
  let urbanCount = 0;
  let yomiCount = 0;
  for (const f of facilities) {
    const pref = assignPref(f, prefGeos, fallbacks);
    const chunk: ChunkKind = f.kind === 'sa' || f.kind === 'pa' ? 'sapa' : f.kind;
    const { yomi, miss } = resolveYomi(f, pref);
    if (miss) yomiMisses.push(miss);
    else yomiCount++;
    const rec: OutFacility = {
      id: f.osmKey,
      n: f.name,
      y: yomi,
      lat: f.lat,
      lon: f.lon,
      pref,
    };
    if (chunk === 'sapa') rec.k = f.kind as 'sa' | 'pa';
    if (f.roads.length > 0) rec.r = f.roads;
    if (f.urban) {
      rec.u = 1;
      urbanCount++;
    }
    chunks[chunk].push(rec);
  }

  if (fallbacks.length > 0) {
    console.log(`⚠ ポリゴン外（最寄り県にフォールバック）: ${fallbacks.length} 件`);
    for (const f of fallbacks.slice(0, 20)) console.log(`  ${f}`);
  }
  console.log(
    `読み: ${yomiCount}/${facilities.length} 件（${((yomiCount / facilities.length) * 100).toFixed(1)}%）`,
  );
  if (yomiMisses.length > 0) {
    console.log(
      `⚠ 読みなし ${yomiMisses.length} 件（出力には含める。overrides/highway-yomi.json の「OSMキー: 読み」で補完可能）:`,
    );
    for (const m of yomiMisses.slice(0, 30)) console.log(`  ${m}`);
    if (yomiMisses.length > 30) console.log(`  ...ほか ${yomiMisses.length - 30} 件`);
  }

  // 件数とデータ品質のサニティチェック（範囲外なら生成失敗として exit 1）。
  // ic は NEXCO 系 + 都市高速出入口 + 国道バイパス等の自動車専用道も含むため多め
  const errors: string[] = [];
  sanity('ic', chunks.ic.length, 1500, 4500, errors);
  sanity('jct', chunks.jct.length, 60, 400, errors);
  sanity('sapa', chunks.sapa.length, 400, 1600, errors);
  const icJct = [...chunks.ic, ...chunks.jct];
  const noRoad = icJct.filter((f) => !f.r).length;
  if (noRoad / icJct.length > 0.4) {
    errors.push(`IC/JCT の道路名欠落率 ${((noRoad / icJct.length) * 100).toFixed(1)}%（>40%）`);
  }
  if (errors.length > 0) {
    console.error('✗ サニティチェック失敗:');
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  await mkdir('public/data/highways', { recursive: true });
  let total = 0;
  const counts: Record<ChunkKind, number> = { ic: 0, jct: 0, sapa: 0 };
  for (const kind of ['ic', 'jct', 'sapa'] as const) {
    const items = chunks[kind].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));
    counts[kind] = items.length;
    total += items.length;
    await writeFile(`public/data/highways/${kind}.json`, JSON.stringify({ kind, items }), 'utf8');
  }

  const nameCount = new Map<string, number>();
  for (const kind of ['ic', 'jct', 'sapa'] as const) {
    for (const f of chunks[kind]) nameCount.set(f.n, (nameCount.get(f.n) ?? 0) + 1);
  }
  const dupNames = [...nameCount.entries()].filter(([, c]) => c > 1);

  await writeFile(
    'public/data/highways/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      counts,
      urbanCount,
      duplicateNameCount: dupNames.length,
      source:
        'OpenStreetMap via Overpass API (ODbL, © OpenStreetMap contributors) + 読み仮名: OSM name:ja-Hira / Wikipedia「日本のインターチェンジ一覧」「日本のサービスエリア・パーキングエリア一覧」(CC BY-SA 4.0)',
    }),
    'utf8',
  );

  console.log(`✓ ${total} 施設（IC ${counts.ic} / JCT ${counts.jct} / SA・PA ${counts.sapa}）`);
  console.log(`都市高速: ${urbanCount} 件 / 道路名なし IC・JCT: ${noRoad} 件`);
  console.log(
    `同名施設グループ: ${dupNames.length} 件（例: ${dupNames.slice(0, 8).map(([n, c]) => `${n}×${c}`).join(', ')}）`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
