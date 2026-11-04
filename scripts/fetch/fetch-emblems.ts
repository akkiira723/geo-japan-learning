import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { EMBLEM_BASE, EMBLEM_PAGES, emblemImageCachePath, parseEmblemPage, type EmblemEntry } from '../lib/emblem-parse.ts';

/**
 * ちきページ「市町村章 都道府県別リスト」を取得する。
 * - ページは data-cache/emblems/pages/<slug>.html にキャッシュ（削除で再取得）
 * - 画像 (gazo.php / gazo1.php) は **Referer が chikipage.net でないと "error" を返す** ので Referer 付きで取得し
 *   data-cache/emblems/img/ に保存（存在すればスキップ = 再開可能）。配信は build が public/data/emblems/img/ に複製する
 * - （旧）（古）（昔）？ 付きの別版は variant として除外し、結果 data-cache/emblems/result/<slug>.json には載せない
 */
const DELAY_MS = 250;
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';
const PNG_MAGIC = 0x89504e47;

export interface EmblemPageResult {
  slug: string;
  pref: number;
  page: string;
  entries: EmblemEntry[];
  excludedVariants: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchBuffer(url: string, referer: string): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Referer: referer },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      lastErr = err;
      console.warn(`  リトライ ${attempt}/3: ${url} (${err instanceof Error ? err.message : err})`);
      await sleep(3000 * attempt);
    }
  }
  throw lastErr;
}

async function fetchPage(slug: string): Promise<string> {
  const cachePath = `data-cache/emblems/pages/${slug}.html`;
  if (existsSync(cachePath)) return readFile(cachePath, 'utf8');
  const url = `${EMBLEM_BASE}${slug}.php`;
  const buf = await fetchBuffer(url, EMBLEM_BASE);
  const html = buf.toString('utf8');
  if (!html.includes('<img src="gazo')) throw new Error(`市章画像が見つからないページ: ${url}`);
  await writeFile(cachePath, html, 'utf8');
  await sleep(DELAY_MS);
  return html;
}

async function fetchImage(slug: string, e: EmblemEntry): Promise<boolean> {
  const dest = emblemImageCachePath(e);
  if (existsSync(dest)) return false;
  const url = `${EMBLEM_BASE}${e.src}.php?dir=${e.dir}&fn=${e.fn}`;
  const buf = await fetchBuffer(url, `${EMBLEM_BASE}${slug}.php`);
  if (buf.length < 8 || buf.readUInt32BE(0) !== PNG_MAGIC) {
    throw new Error(`PNG ではない応答（Referer 拒否 "${buf.subarray(0, 20).toString()}"?）: ${url}`);
  }
  await writeFile(dest, buf);
  await sleep(DELAY_MS);
  return true;
}

async function main() {
  await mkdir('data-cache/emblems/pages', { recursive: true });
  await mkdir('data-cache/emblems/img', { recursive: true });
  await mkdir('data-cache/emblems/result', { recursive: true });

  let total = 0, downloaded = 0, variants = 0;
  for (const [slug, pref] of EMBLEM_PAGES) {
    const html = await fetchPage(slug);
    const all = parseEmblemPage(html);
    const entries = all.filter((e) => e.variant === null);
    const excludedVariants = all.length - entries.length;
    // dir+src+fn が同じで名前が違う（= 画像を共有している）ものは両方残すが警告する
    const seen = new Map<string, string>();
    for (const e of entries) {
      const k = `${e.dir}|${e.src}|${e.fn}`;
      const prev = seen.get(k);
      if (prev && prev !== e.name) console.warn(`  ⚠ 同一画像キー ${k}: ${prev} / ${e.name}`);
      seen.set(k, e.name);
    }
    process.stdout.write(`${slug} (pref ${pref}): ${entries.length} 件（別版除外 ${excludedVariants}）画像取得中...`);
    let n = 0;
    for (const e of entries) {
      if (await fetchImage(slug, e)) n++;
    }
    console.log(` 新規 ${n} 枚`);
    const result: EmblemPageResult = { slug, pref, page: `${EMBLEM_BASE}${slug}.php`, entries, excludedVariants };
    await writeFile(`data-cache/emblems/result/${slug}.json`, JSON.stringify(result), 'utf8');
    total += entries.length;
    downloaded += n;
    variants += excludedVariants;
  }
  console.log(`✓ ${total} 件（別版除外 ${variants}）、画像新規取得 ${downloaded} 枚`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
