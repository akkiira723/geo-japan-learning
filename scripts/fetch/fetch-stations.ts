import { mkdir, writeFile } from 'node:fs/promises';

const SHEET_ID = '1RuJhWBLY0U_rXWJRYmkQOGJiMoGzRO_1e2own-1bAZM';
const STATIONS_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('駅')}`;
const LINES_URL = 'https://raw.githubusercontent.com/Seo-4d696b75/station_database/main/out/main/line.json';
const STATIONS_KANA_URL = 'https://raw.githubusercontent.com/Seo-4d696b75/station_database/main/out/main/station.json';

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
  return res.text();
}

async function main() {
  await mkdir('data-cache/raw', { recursive: true });

  console.log('駅シートを取得中...');
  const csv = await fetchText(STATIONS_URL);
  if (!csv.startsWith('"station_cd"')) {
    throw new Error(`駅シートの形式が想定と異なります。先頭: ${csv.slice(0, 80)}`);
  }
  await writeFile('data-cache/raw/stations.csv', csv, 'utf8');
  console.log(`  → data-cache/raw/stations.csv (${csv.length.toLocaleString()} bytes)`);

  console.log('station_database line.json を取得中...');
  const lines = await fetchText(LINES_URL);
  await writeFile('data-cache/raw/line.json', lines, 'utf8');
  console.log(`  → data-cache/raw/line.json (${lines.length.toLocaleString()} bytes)`);

  console.log('station_database station.json（読み仮名辞書）を取得中...');
  const stations = await fetchText(STATIONS_KANA_URL);
  await writeFile('data-cache/raw/station-kana.json', stations, 'utf8');
  console.log(`  → data-cache/raw/station-kana.json (${stations.length.toLocaleString()} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
