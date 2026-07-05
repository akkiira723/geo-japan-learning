import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { analyzeImage, hammingHex } from '../lib/image.ts';

const BASE = 'https://we-love-manho.com/';
const DELAY_MS = 200;
const MAX_DESIGNS_PER_MUNI = 3; // 市章1枚 + デザイン蓋最大3枚
const COLOR_FRACTION_MAX = 0.06;
const DHASH_DUP_MAX = 6;

/** 都道府県コード → インデックスページ */
const PREF_INDEX: Record<number, string> = {
  1: 'hokkaidou/hokkaidou.html', 2: 'aomori/aomori.html', 3: 'iwate/iwate.html',
  4: 'miyagi/miyagi.html', 5: 'akita/akita.html', 6: 'yamagata/yamagataitirann.html',
  7: 'hukusima/hukusima.html', 8: 'ibaraki/ibaraki.html', 9: 'totigi/totigi.html',
  10: 'gunnma/gunnma.html', 11: 'saitama/saitamaitirann.html', 12: 'tiba/tiba.html',
  13: 'toukyou/to/to.html', 14: 'kanagawa/kanagawa.html', 15: 'niigata/niigata.html',
  16: 'toyama/toyamaitirann.html', 17: 'isikawa/isikawa.html', 18: 'hukui/hukui.html',
  19: 'yamanasi/yamanasiitirann.html', 20: 'nagano/naganoitirann.html', 21: 'gihu/gihu.html',
  22: 'sizuoka/sizuokaitirann.html', 23: 'aiti/aitiitirann.html', 24: 'mie/mie.html',
  25: 'siga/sigaitirann.html', 26: 'kyoutohu/kyoutohu.html', 27: 'oosakahu/oosakahu.html',
  28: 'hyougo/hyougoitirann.html', 29: 'nara/naraitirann.html', 30: 'wakayama/wakayama.html',
  31: 'tottori/tottori.html', 32: 'simane/simane.html', 33: 'okayama/okayama.html',
  34: 'hirosima/hirosima.html', 35: 'yamaguti/yamaguti.html', 36: 'tokusima/tokusima.html',
  37: 'kagawa/kagawa.html', 38: 'ehime/ehime.html', 39: 'kouti/kouti.html',
  40: 'hukuoka/hukuokaitirann.html', 41: 'saga/saga.html', 42: 'nagasaki/nagasaki.html',
  43: 'kumamoto/kumamoto.html', 44: 'ooita/ooita.html', 45: 'miyazaki/miyazaki.html',
  46: 'kagosima/kagosima.html', 47: 'okinawa/okinawa.html',
};

// テキストだけで除外できるもの（ダウンロード前に判定）
const SKIP_TEXT =
  /マンホールカード|ポケふた|展示蓋|展示されて|同じデザイン|同デザイン|色違い|親子|カードの座標|仕切弁|制水弁|空気弁|消火栓|防火水槽|量水器|止水栓|減圧弁|排泥弁|電話|電気|通信|側溝|汚水枡|汚水桝|排水桝|集水枡|基準点|境界|越境/;
// 「上記の〜」は同デザインの変種（小型・受枠違い・表記違い等）なので原則スキップ。
// ただしノンカラー版はカラー版の代わりに採用したいので残す
const SAME_AS_ABOVE = /上記/;
const NONCOLOR_VARIANT = /ノンカラー(?!.{0,6}小型)/;
// テキストでカラー蓋と分かるもの
const COLOR_TEXT = /カラー(?!版の無)|(クリーム|茶|青|緑|赤|黄|ピンク|橙|紫)色|彩色/;
const NONCOLOR_TEXT = /ノンカラー|無彩色|色無し/;
const EMBLEM_TEXT = /[市町村区]章/;

interface KeptImage {
  url: string;
  kind: 'design' | 'emblem';
  desc: string;
}

export interface MuniResult {
  pref: number;
  name: string;
  gun: string;
  page: string;
  imgs: KeptImage[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithCache(url: string, cachePath: string, binary = false): Promise<Buffer | null> {
  if (existsSync(cachePath)) return readFile(cachePath);
  await sleep(DELAY_MS);
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(cachePath, binary ? buf : buf);
  return buf;
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

function resolveUrl(href: string, pageUrl: string): string {
  return new URL(href, pageUrl).href;
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 県インデックスから (自治体名, 郡, ページURL) を抽出 */
function parseIndex(html: string, indexUrl: string): { name: string; gun: string; url: string }[] {
  const out: { name: string; gun: string; url: string }[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.html)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const href = m[1];
    if (/^https?:\/\//.test(href) && !href.includes('we-love-manho.com')) continue;
    const text = stripTags(m[2]);
    if (!text || text.length < 2) continue;
    // 「観音寺市.」「綾川町（綾歌郡）」形式
    const nm = text.match(/^([^（(．.]+?)[．.]?(?:[（(]([^）)]+)[）)])?[．.]?$/);
    if (!nm) continue;
    const name = nm[1].trim();
    const gun = (nm[2] ?? '').trim();
    // 市町村区以外（県ページ・雑多リンク）は除外
    if (!/[市町村区]$/.test(name)) continue;
    const url = resolveUrl(href, indexUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ name, gun, url });
  }
  return out;
}

/** 自治体ページから (画像URL, 説明文) ペアを抽出（説明は画像の直後） */
function parsePairs(html: string, pageUrl: string): { url: string; desc: string }[] {
  const out: { url: string; desc: string }[] = [];
  const parts = html.split(/<img\s/i).slice(1);
  for (const part of parts) {
    const srcM = part.match(/^[^>]*?src="([^"]+)"/i);
    if (!srcM) continue;
    const src = srcM[1];
    if (!/\.jpe?g$/i.test(src)) continue; // gif バッジ等を除外
    const rest = part.slice(part.indexOf('>') + 1);
    const desc = stripTags(rest).slice(0, 400);
    out.push({ url: resolveUrl(src, pageUrl), desc });
  }
  return out;
}

async function processMuni(muni: { name: string; gun: string; url: string }, pref: number): Promise<MuniResult | null> {
  const pageCache = `data-cache/manho/pages/${sha1(muni.url)}.html`;
  const buf = await fetchWithCache(muni.url, pageCache);
  if (!buf) {
    console.warn(`  ⚠ ページ取得失敗: ${muni.name} ${muni.url}`);
    return null;
  }
  const pairs = parsePairs(buf.toString('utf8'), muni.url);

  const kept: KeptImage[] = [];
  const hashes: string[] = [];
  let emblemKept = false;
  let designCount = 0;

  for (const { url, desc } of pairs) {
    if (desc.length < 8) continue;
    if (SKIP_TEXT.test(desc)) continue;
    if (SAME_AS_ABOVE.test(desc) && !NONCOLOR_VARIANT.test(desc)) continue;
    const isEmblem = EMBLEM_TEXT.test(desc);
    if (isEmblem && emblemKept) continue;
    if (!isEmblem && designCount >= MAX_DESIGNS_PER_MUNI) continue;
    if (COLOR_TEXT.test(desc) && !NONCOLOR_TEXT.test(desc)) continue;

    const imgCache = `data-cache/manho/img/${sha1(url)}.jpg`;
    const img = await fetchWithCache(url, imgCache, true);
    if (!img || img.length < 5000) continue;
    let stats;
    try {
      stats = await analyzeImage(img);
    } catch {
      continue;
    }
    if (stats.colorFraction > COLOR_FRACTION_MAX) continue;
    if (hashes.some((h) => hammingHex(h, stats.dhash) <= DHASH_DUP_MAX)) continue;

    hashes.push(stats.dhash);
    kept.push({ url, kind: isEmblem ? 'emblem' : 'design', desc: desc.slice(0, 60) });
    if (isEmblem) emblemKept = true;
    else designCount++;
    if (emblemKept && designCount >= MAX_DESIGNS_PER_MUNI) break;
  }

  if (kept.length === 0) return null;
  return { pref, name: muni.name, gun: muni.gun, page: muni.url, imgs: kept };
}

async function main() {
  const onlyPref = process.argv[2] ? Number(process.argv[2]) : null;
  await mkdir('data-cache/manho/pages', { recursive: true });
  await mkdir('data-cache/manho/img', { recursive: true });
  await mkdir('data-cache/manho/result', { recursive: true });

  for (const [prefStr, indexPath] of Object.entries(PREF_INDEX)) {
    const pref = Number(prefStr);
    if (onlyPref && pref !== onlyPref) continue;
    const resultPath = `data-cache/manho/result/pref-${String(pref).padStart(2, '0')}.json`;
    if (existsSync(resultPath)) {
      console.log(`pref ${pref}: 済み（スキップ）`);
      continue;
    }
    const indexUrl = BASE + indexPath;
    const idxBuf = await fetchWithCache(indexUrl, `data-cache/manho/pages/${sha1(indexUrl)}.html`);
    if (!idxBuf) {
      console.warn(`✗ インデックス取得失敗: pref ${pref}`);
      continue;
    }
    const munis = parseIndex(idxBuf.toString('utf8'), indexUrl);
    console.log(`pref ${pref}: ${munis.length} 自治体ページ`);
    const results: MuniResult[] = [];
    for (const muni of munis) {
      const r = await processMuni(muni, pref);
      if (r) results.push(r);
    }
    await writeFile(resultPath, JSON.stringify(results, null, 1), 'utf8');
    const imgs = results.reduce((s, r) => s + r.imgs.length, 0);
    console.log(`  → ${results.length} 自治体 / ${imgs} 枚`);
  }
  console.log('完了');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
