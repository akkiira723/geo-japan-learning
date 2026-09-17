import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { readXlsx } from '../lib/xlsx.ts';
import type { CensusEntry } from '../lib/population.ts';

/**
 * e-Stat 令和2年国勢調査「都道府県・市区町村別の主な結果」(major_results_2020.xlsx) から
 * 市区町村別の総人口を取り出す。CSV 提供が無いので xlsx を自前パースする。
 * シート「第１面事項_2020年」: 10行目以降が本体。列B = "01100_札幌市"（5桁コード_名称）、
 * 列D = 地域識別コード（a/1/0/2/3）、列E = 総人口（数値。秘匿等は "-"）。
 */
const URL = 'https://www.e-stat.go.jp/stat-search/file-download?statInfId=000032143614&fileKind=0';
const RAW = 'data-cache/raw/census2020-major-results.xlsx';
const OUT = 'data-cache/population/census2020.json';
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';

async function main() {
  await mkdir('data-cache/raw', { recursive: true });
  await mkdir('data-cache/population', { recursive: true });
  if (existsSync(OUT)) {
    const cached = JSON.parse(await readFile(OUT, 'utf8'));
    console.log(`国勢調査人口: キャッシュ済み（${cached.entries.length} 件、スキップ）`);
    return;
  }
  if (!existsSync(RAW)) {
    console.log('e-Stat 令和2年国勢調査 主な結果 (xlsx) を取得中...');
    const res = await fetch(URL, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${URL}`);
    const buf = Buffer.from(await res.arrayBuffer());
    // ZIP でなければ e-Stat のエラーページ等なので保存しない
    if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('xlsx ではない応答（ZIP シグネチャ無し）。URL の改版を疑うこと');
    await writeFile(RAW, buf);
  }

  const wb = readXlsx(await readFile(RAW));
  const sheetIndex = wb.sheetNames.findIndex((n) => n.includes('第１面'));
  if (sheetIndex < 0) throw new Error(`「第１面事項」シートが見つかりません: ${wb.sheetNames.join(', ')}`);
  const entries: CensusEntry[] = [];
  for (const row of wb.rows(sheetIndex)) {
    const m = /^(\d{5})_(.+)$/.exec(row[1] ?? '');
    if (!m) continue;
    const popText = (row[4] ?? '').trim();
    entries.push({
      code: m[1],
      name: m[2].trim(),
      kind: (row[3] ?? '').trim(),
      pop: /^\d+$/.test(popText) ? Number(popText) : null,
    });
  }
  if (entries.length < 1900) throw new Error(`件数が少なすぎます（${entries.length} 件）。約1,970行（全国+都道府県+市区町村）あるはず`);
  const sapporo = entries.find((e) => e.code === '01100');
  if (!sapporo || (sapporo.pop ?? 0) < 1_900_000) throw new Error('札幌市の人口が想定外（列レイアウトの変更を疑うこと）');

  await writeFile(
    OUT,
    JSON.stringify({ source: 'e-Stat 令和2年国勢調査 都道府県・市区町村別の主な結果 (statInfId=000032143614)', entries }),
    'utf8',
  );
  console.log(`国勢調査人口: ${entries.length} 件 → ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
