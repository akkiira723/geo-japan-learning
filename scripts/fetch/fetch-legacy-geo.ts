import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const FILES: [string, string][] = [
  // 平成の大合併直前のスナップショット（全市区町村ポリゴン・簡略化版）
  // 1995年版も併用し、1995〜2000年の消滅（北広島市成立・篠山市成立など）を拾う
  [
    'https://geoshape.ex.nii.ac.jp/city/topojson/20001001/jp_city.c.topojson',
    'data-cache/geo/legacy/jp_city_20001001.c.topojson',
  ],
  [
    'https://geoshape.ex.nii.ac.jp/city/topojson/19951001/jp_city.c.topojson',
    'data-cache/geo/legacy/jp_city_19951001.c.topojson',
  ],
  // ID一覧（名称・郡・接尾辞）と スナップショット別ファイルリスト（現存判定に使用）
  ['https://geoshape.ex.nii.ac.jp/city/dataset/geoshape_city_id.csv', 'data-cache/raw/geoshape_city_id.csv'],
  ['https://geoshape.ex.nii.ac.jp/city/dataset/json-list.csv', 'data-cache/raw/geoshape-json-list.csv'],
];

async function main() {
  await mkdir('data-cache/geo/legacy', { recursive: true });
  await mkdir('data-cache/raw', { recursive: true });
  for (const [url, dest] of FILES) {
    if (existsSync(dest)) {
      console.log(`キャッシュ済み: ${dest}`);
      continue;
    }
    process.stdout.write(`${url} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
    const text = await res.text();
    await writeFile(dest, text, 'utf8');
    console.log(`${(text.length / 1e6).toFixed(1)} MB`);
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log('完了');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
