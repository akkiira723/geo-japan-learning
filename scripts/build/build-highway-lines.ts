import { readFile, writeFile } from 'node:fs/promises';
import { roundLine4, simplifyLine, type Line } from '../lib/simplify.ts';

/**
 * data-cache/highway/lines.json（motorway way の out geom）から
 * 地図オーバーレイ用の線形 GeoJSON を生成する。
 * 端点 node が一致する way をチェーン結合してから DP 簡略化する
 * （way 境界をまたいで間引けるうえ、接続点の重複座標も消える）。
 * ref/name での論理マージはしない — 表記ゆれ解決が割に合わず、スタイル一律なので不要。
 */

/** DP 許容誤差（度）。約30m。出力が 2MB を超えるようなら 5e-4 へ上げる */
const TOLERANCE = 3e-4;
/** サニティ: 日本の高速道路網（上下線別線形を含む）としてありえる総延長の範囲 */
const MIN_TOTAL_KM = 15_000;
const MAX_TOTAL_KM = 35_000;
const MAX_SIZE_MB = 2;

interface OsmWay {
  type: string;
  id: number;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

function lineLengthKm(line: Line): number {
  let km = 0;
  for (let i = 1; i < line.length; i++) km += haversineKm(line[i - 1], line[i]);
  return km;
}

interface Chain {
  coords: Line;
  head: number; // 先頭の node id
  tail: number; // 末尾の node id
}

/** 端点 node id が一致する way をグリーディに連結する */
function joinWays(ways: OsmWay[]): Line[] {
  // 端点 node id → その端点を持つ未使用 way のリスト
  const byEndpoint = new Map<number, OsmWay[]>();
  const add = (nodeId: number, w: OsmWay) => {
    const list = byEndpoint.get(nodeId);
    if (list) list.push(w);
    else byEndpoint.set(nodeId, [w]);
  };
  for (const w of ways) {
    add(w.nodes[0], w);
    add(w.nodes[w.nodes.length - 1], w);
  }
  const used = new Set<number>();
  const takeAt = (nodeId: number): OsmWay | null => {
    const list = byEndpoint.get(nodeId);
    if (!list) return null;
    while (list.length > 0) {
      const w = list[list.length - 1];
      if (used.has(w.id)) {
        list.pop();
        continue;
      }
      used.add(w.id);
      return w;
    }
    return null;
  };
  const wayCoords = (w: OsmWay): Line => w.geometry.map((g) => [g.lon, g.lat]);

  const chains: Line[] = [];
  for (const start of ways) {
    if (used.has(start.id)) continue;
    used.add(start.id);
    const chain: Chain = {
      coords: wayCoords(start),
      head: start.nodes[0],
      tail: start.nodes[start.nodes.length - 1],
    };
    // 末尾側・先頭側それぞれへ、つながる way が尽きるまで伸ばす
    for (;;) {
      const w = takeAt(chain.tail);
      if (!w) break;
      const coords = wayCoords(w);
      if (w.nodes[0] === chain.tail) {
        chain.coords.push(...coords.slice(1));
        chain.tail = w.nodes[w.nodes.length - 1];
      } else {
        chain.coords.push(...coords.reverse().slice(1));
        chain.tail = w.nodes[0];
      }
    }
    for (;;) {
      const w = takeAt(chain.head);
      if (!w) break;
      const coords = wayCoords(w);
      if (w.nodes[w.nodes.length - 1] === chain.head) {
        chain.coords.unshift(...coords.slice(0, -1));
        chain.head = w.nodes[0];
      } else {
        chain.coords.unshift(...coords.reverse().slice(0, -1));
        chain.head = w.nodes[w.nodes.length - 1];
      }
    }
    chains.push(chain.coords);
  }
  return chains;
}

async function main() {
  const raw = JSON.parse(await readFile('data-cache/highway/lines.json', 'utf8'));
  const ways = (raw.elements as OsmWay[]).filter(
    (e) => e.type === 'way' && Array.isArray(e.geometry) && e.geometry.length >= 2,
  );
  console.log(`入力: ${ways.length} way`);

  const chains = joinWays(ways);
  const rawPoints = chains.reduce((n, c) => n + c.length, 0);

  const simplified = chains
    .map((c) => roundLine4(simplifyLine(c, TOLERANCE)))
    .filter((c) => c.length >= 2);
  const points = simplified.reduce((n, c) => n + c.length, 0);
  const totalKm = simplified.reduce((n, c) => n + lineLengthKm(c), 0);

  const fc = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          source: 'OpenStreetMap via Overpass API (ODbL, © OpenStreetMap contributors)',
        },
        // 単一 Feature の MultiLineString: Leaflet 側で 1 Polyline になり描画レイヤ数が最小で済む
        geometry: { type: 'MultiLineString', coordinates: simplified },
      },
    ],
  };
  const json = JSON.stringify(fc);
  const sizeMb = json.length / 1e6;
  console.log(
    `チェーン ${chains.length} 本 / 点数 ${rawPoints} → ${points}（tol=${TOLERANCE}）/ 総延長 ${Math.round(totalKm)} km / ${sizeMb.toFixed(2)} MB`,
  );

  if (totalKm < MIN_TOTAL_KM || totalKm > MAX_TOTAL_KM) {
    console.error(`✗ 総延長 ${Math.round(totalKm)} km が想定範囲 ${MIN_TOTAL_KM}〜${MAX_TOTAL_KM} km を外れている（取得漏れ/重複の疑い）`);
    process.exit(1);
  }
  if (sizeMb > MAX_SIZE_MB) {
    console.error(`✗ 出力 ${sizeMb.toFixed(2)} MB が ${MAX_SIZE_MB} MB を超過。TOLERANCE を上げて再実行すること`);
    process.exit(1);
  }

  await writeFile('public/data/highways/lines.json', json, 'utf8');
  console.log('✓ public/data/highways/lines.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
