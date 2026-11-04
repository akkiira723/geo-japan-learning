import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * 日本マンホール蓋学会（we-love-manho.com）のページ構造に関する共通処理。
 * クロール（fetch-manholes.ts）と手動選定ツール（select/manhole-select-server.ts）で共用する。
 */

export const MANHO_BASE = 'https://we-love-manho.com/';
const DELAY_MS = 200;

/** 都道府県コード → 県インデックスページ（11県は `{d}itirann.html`、東京だけ `toitirann.html`） */
export const PREF_INDEX: Record<number, string> = {
  1: 'hokkaidou/hokkaidou.html', 2: 'aomori/aomori.html', 3: 'iwate/iwate.html',
  4: 'miyagi/miyagi.html', 5: 'akita/akita.html', 6: 'yamagata/yamagataitirann.html',
  7: 'hukusima/hukusima.html', 8: 'ibaraki/ibaraki.html', 9: 'totigi/totigi.html',
  10: 'gunnma/gunnma.html', 11: 'saitama/saitamaitirann.html', 12: 'tiba/tiba.html',
  13: 'toukyou/toitirann.html', 14: 'kanagawa/kanagawa.html', 15: 'niigata/niigata.html',
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

export function prefIndexUrl(pref: number): string {
  return MANHO_BASE + PREF_INDEX[pref];
}

/** 「上記の〜」「同上」「上と同じ〜」= 直前の蓋の変種を指す説明 */
export const ABOVE_REF = /上記|同上|上の(?:蓋|写真|もの)|(?<![右左])上と/;

export function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}

export function resolveUrl(href: string, pageUrl: string): string {
  return new URL(href, pageUrl).href;
}

export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface IndexLink {
  /** リンクテキスト（タグ除去・空白正規化済み。例: 「横浜市デザイン１」「愛川町（愛甲郡）」「あ 愛別町」） */
  text: string;
  url: string;
}

/** 県インデックスページ内の自治体ページへのリンクを全部（カテゴリ語つき・雑多リンク込み）取り出す */
export function parseIndexLinks(html: string, indexUrl: string): IndexLink[] {
  const out: IndexLink[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(/<a[^>]+href="([^"]+\.html)"[^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    const href = m[1];
    if (/^https?:\/\//.test(href) && !href.includes('we-love-manho.com')) continue;
    const text = stripTags(m[2]);
    if (!text || text.length < 2) continue;
    const url = resolveUrl(href, indexUrl);
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ text, url });
  }
  return out;
}

export interface IndexEntry {
  name: string;
  gun: string;
  url: string;
}

/** 北海道インデックスの「あ 愛別町」のようなかな見出し混入を除去 */
export function stripKanaHeading(text: string): string {
  return text.replace(/^[ぁ-んァ-ヶ]\s+/, '');
}

/**
 * リンクテキストを (自治体名, 郡) に分解する。「観音寺市.」「綾川町（綾歌郡）」「横浜市デザイン１」形式。
 * 市町村区で終わらない名前（「横浜市ベイブリッジ」「神奈川県広域」等）は null
 */
export function parseIndexText(text: string): { name: string; gun: string } | null {
  const t = stripKanaHeading(text);
  // 規格蓋・その他カテゴリのページは自治体特定に不向き
  if (/規格|その他|デザイン蓋以外/.test(t)) return null;
  const nm = t.match(/^([^（(．.]+?)[．.]?(?:[（(]([^）)]+)[）)])?[．.]?$/);
  if (!nm) return null;
  // 「大阪市デザイン」「所沢市デザイン蓋」「横浜市デザイン１」のようなカテゴリ語つきの名前を正規化
  const name = nm[1].trim().replace(/デザイン蓋?[0-9０-９]*$/, '');
  const gun = (nm[2] ?? '').trim();
  if (!/[市町村区]$/.test(name)) return null;
  return { name, gun };
}

/** 県インデックスから (自治体名, 郡, ページURL) を抽出（クロール用。カテゴリページ・雑多リンクは除外） */
export function parseIndex(html: string, indexUrl: string): IndexEntry[] {
  const out: IndexEntry[] = [];
  for (const link of parseIndexLinks(html, indexUrl)) {
    const parsed = parseIndexText(link.text);
    if (!parsed) continue;
    out.push({ name: parsed.name, gun: parsed.gun, url: link.url });
  }
  return out;
}

export interface ImgPair {
  url: string;
  /** 画像直後の説明文（撮影日等のメタ情報込み、400字まで） */
  desc: string;
}

/** 自治体ページから (画像URL, 説明文) ペアを抽出（説明は画像の直後） */
export function parsePairs(html: string, pageUrl: string): ImgPair[] {
  const out: ImgPair[] = [];
  // 「NEW」バッジ等の gif <img> が写真と説明文の間に挟まっていることがあり、
  // そのまま split すると説明文が gif 側に付いて捨てられるため先に除去する
  const cleaned = html.replace(/<img\s[^>]*src="[^"]*\.gif"[^>]*>/gi, ' ');
  const parts = cleaned.split(/<img\s/i).slice(1);
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

/** 撮影日・撮影者等のメタ情報とページ末尾のナビ文言を落とした説明本文（判定用） */
export function descBody(desc: string): string {
  return desc.split(/・(?:撮影日|提供日|撮影場所|撮影者|提供者)[：:]/)[0].split(/検索でこのページ/)[0];
}

/** サイトの説明文から撮影日・撮影者等のメタ情報を落とし、デザインの解説だけを残す */
export function cleanDesc(desc: string): string {
  let d = descBody(desc);
  d = d.replace(/(下水道?管|汚水管|雨水管|合流管|農業集落排水|集落排水|農業用水用?|消雪用?)?\s*(マンホールの?蓋|小型蓋|ハンドホールの?蓋?)\s*$/, '');
  d = d.replace(/^・/, '').trim();
  return d.slice(0, 220);
}

/** 「上記の〜」「上と同じ〜」の参照部分を、参照先（直前の画像）の説明文で置き換える */
export function resolveAboveRef(desc: string, refDesc: string): string {
  const r = '「' + refDesc.replace(/[。.\s]+$/, '') + '」';
  return desc
    .replace(/上記|上の(?:蓋|写真|もの)|(?<![右左])上(?=と)/g, r)
    .replace(/同上/g, `${r}と同じ`);
}

export interface DescribedImg {
  url: string;
  /** 元の説明文（メタ情報込み） */
  desc: string;
  /** クイズ表示用の説明文（cleanDesc + 「上記の〜」の参照解決） */
  display: string;
  refersAbove: boolean;
}

/**
 * ページ内の全画像について、クイズ表示用の説明文を付ける。
 * 選定ツールとクロールで同じ説明文になるようにここに集約する
 */
export function describePairs(pairs: ImgPair[]): DescribedImg[] {
  let lastFullDesc = '';
  return pairs.map(({ url, desc }) => {
    const body = descBody(desc);
    const refersAbove = ABOVE_REF.test(body);
    let display = cleanDesc(desc);
    if (refersAbove && lastFullDesc) display = resolveAboveRef(display, cleanDesc(lastFullDesc));
    if (desc.length >= 8 && !refersAbove) lastFullDesc = desc;
    return { url, desc, display, refersAbove };
  });
}

// ---- キャッシュ付き取得（data-cache/manho/） ----

export const PAGE_CACHE_DIR = 'data-cache/manho/pages';
export const IMG_CACHE_DIR = 'data-cache/manho/img';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithCache(url: string, cachePath: string): Promise<Buffer | null> {
  if (existsSync(cachePath)) return readFile(cachePath);
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(DELAY_MS * attempt);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) return null;
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(cachePath, buf);
      return buf;
    } catch (err) {
      console.warn(`  リトライ ${attempt}/3: ${url} (${err instanceof Error ? err.message : err})`);
      if (attempt === 3) return null;
      await sleep(3000 * attempt);
    }
  }
  return null;
}

export async function ensureManhoCacheDirs(): Promise<void> {
  await mkdir(PAGE_CACHE_DIR, { recursive: true });
  await mkdir(IMG_CACHE_DIR, { recursive: true });
  await mkdir('data-cache/manho/result', { recursive: true });
}

/** 同サイトのページ HTML（UTF-8）をキャッシュ経由で取得 */
export async function fetchManhoPage(url: string): Promise<string | null> {
  const buf = await fetchWithCache(url, `${PAGE_CACHE_DIR}/${sha1(url)}.html`);
  return buf ? buf.toString('utf8') : null;
}

/** 同サイトの画像をキャッシュ経由で取得 */
export async function fetchManhoImage(url: string): Promise<Buffer | null> {
  return fetchWithCache(url, `${IMG_CACHE_DIR}/${sha1(url)}.jpg`);
}
