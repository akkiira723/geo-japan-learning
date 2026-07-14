import { readFile, writeFile } from 'node:fs/promises';
import { joinWays, lineLengthKm, type OsmWay } from '../lib/join-ways.ts';
import { roundLine4, simplifyLine } from '../lib/simplify.ts';

/**
 * data-cache/highway/lines.json（motorway way の out geom）から
 * 地図オーバーレイ用の線形 GeoJSON を生成する。
 * 端点 node が一致する way をチェーン結合（lib/join-ways.ts）してから DP 簡略化する
 * （way 境界をまたいで間引けるうえ、接続点の重複座標も消える）。
 */

/** DP 許容誤差（度）。約30m。出力が 2MB を超えるようなら 5e-4 へ上げる */
const TOLERANCE = 3e-4;
/** サニティ: 日本の高速道路網（上下線別線形を含む）としてありえる総延長の範囲 */
const MIN_TOTAL_KM = 15_000;
const MAX_TOTAL_KM = 35_000;
const MAX_SIZE_MB = 2;

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
