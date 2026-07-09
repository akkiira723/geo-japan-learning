import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { loadClaims, computeSplitMunis } from '../lib/areacode-claims.ts';

// 複数の市外局番に分割される市町村について、国勢調査 2020 の町丁・字等（小地域）
// ポリゴンを Geoshape（歴史的行政区域データと同じ提供元）から取得する。
// 事前に data:areacodes の fetch（PDF）と fetch-muni-geo（N03）が必要。
const BASE = 'https://geoshape.ex.nii.ac.jp/ka/topojson/2020';

async function main() {
  const { claims } = await loadClaims();
  const splits = await computeSplitMunis(claims);

  const needs = new Map<string, string>(); // code5 → 表示用ラベル
  for (const s of splits) {
    for (const [scope, code5] of s.chochoNeeds) {
      needs.set(code5, `${s.pref}${s.muni}${scope}`);
    }
  }
  console.log(`分割市町村 ${splits.length} 件 / 小地域データ ${needs.size} ファイル`);

  await mkdir('data-cache/geo/chocho', { recursive: true });
  let fetched = 0;
  for (const [code5, label] of [...needs.entries()].sort()) {
    const dest = `data-cache/geo/chocho/r2ka${code5}.topojson`;
    if (existsSync(dest)) continue;
    const url = `${BASE}/${code5.slice(0, 2)}/r2ka${code5}.topojson`;
    process.stdout.write(`${code5} ${label} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
    const text = await res.text();
    await writeFile(dest, text, 'utf8');
    console.log(`${(text.length / 1024).toFixed(0)} KB`);
    fetched++;
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log(`完了（新規取得 ${fetched} / 既存 ${needs.size - fetched}）`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
