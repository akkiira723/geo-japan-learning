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

// テキストだけで除外できるもの（ダウンロード前に判定）
const SKIP_TEXT =
  /マンホールカード|ポケふた|展示蓋|展示されて|展示した後|展示の様子|展示品|同じデザイン|同デザイン|色違い|親子|カードの座標|仕切弁|制水弁|空気弁|消火栓|防火水槽|量水器|止水栓|減圧弁|排泥弁|電話|電気|通信|側溝|汚水枡|汚水桝|排水桝|集水枡|基準点|境界|越境/;
// 蓋そのものではない写真（歩道絵・案内板・デザインの元ネタ探訪など）と明言しているもの
const EXPLICIT_NONLID =
  /マンホール(?:蓋)?では(?:なく|ありません)|歩道絵|案内板|タイル板|蓋が無かったので|行った証し|デザインの元にな|蓋の.{0,8}とは違/;
// 蓋ではなくデザインの元ネタ（像・碑・建物・風景など）の写真を示唆する語。
// 蓋の絵柄の説明にも登場しうるため、円形検出スコアが低く蓋らしい語彙もない場合のみ除外に使う
const NONLID_TEXT =
  /役場|庁舎|記念碑|文学碑|石碑|銅像|の像|像です|建立|モニュメント|灯台|燈籠|大橋|神社|鳥居|時計塔|の塔|風車|湿原|アンテナ|タイル|学校|の写真|入口/;
// 蓋の写真であることを示唆する語彙
const LID_HINT =
  /蓋|マンホール|ハンドホール|地紋|地模様|模様|絵柄|[市町村区]章|の文字|文字入|表記|汚水|雨水|下水|合流|農集|集落排水|規格/;
// 「上記の〜」「上と同じ〜」は同デザインの変種（小型・受枠違い・表記違い等）なので原則スキップ。
// ただしノンカラー版はカラー版の代わりに採用したいので残す
const ABOVE_REF = /上記|同上|上の(?:蓋|写真|もの)|(?<![右左])上と/;
const NONCOLOR_VARIANT = /ノ[ンー]カラー(?!.{0,6}小型)/;
// テキストでカラー蓋と分かるもの
const COLOR_TEXT = /カラー(?!版の無)|(クリーム|茶|青|緑|赤|黄|ピンク|橙|紫)色|彩色/;
const NONCOLOR_TEXT = /ノ[ンー]カラー|無彩色|無着色|色無し/;
const EMBLEM_TEXT = /[市町村区]章/;
// 円形（楕円含む）の輪郭がこれ未満なら蓋の写真ではないとみなす
const CIRCLE_HARD_MIN = 0.35;
// これ未満かつ NONLID_TEXT を含むなら元ネタ写真とみなす
const CIRCLE_SOFT_MIN = 0.6;

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

/** ヒューリスティックで拾いきれない蓋以外の写真（URL単位の手動除外、main で読み込む） */
let imgExcludes = new Set<string>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWithCache(url: string, cachePath: string): Promise<Buffer | null> {
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
    // 規格蓋・その他カテゴリのページは自治体特定に不向きなので除外
    if (/規格|その他|デザイン蓋以外/.test(text)) continue;
    const nm = text.match(/^([^（(．.]+?)[．.]?(?:[（(]([^）)]+)[）)])?[．.]?$/);
    if (!nm) continue;
    // 「大阪市デザイン」「所沢市デザイン蓋」「横浜市デザイン１」のようなカテゴリ語つきの名前を正規化
    const name = nm[1].trim().replace(/デザイン蓋?[0-9０-９]*$/, '');
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
function descBody(desc: string): string {
  return desc.split(/・(?:撮影日|提供日|撮影場所|撮影者|提供者)[：:]/)[0].split(/検索でこのページ/)[0];
}

/** サイトの説明文から撮影日・撮影者等のメタ情報を落とし、デザインの解説だけを残す */
function cleanDesc(desc: string): string {
  let d = descBody(desc);
  d = d.replace(/(下水道?管|汚水管|雨水管|合流管|農業集落排水|集落排水|農業用水用?|消雪用?)?\s*(マンホールの?蓋|小型蓋|ハンドホールの?蓋?)\s*$/,'');
  d = d.replace(/^・/, '').trim();
  return d.slice(0, 220);
}

/** 「上記の〜」「上と同じ〜」の参照部分を、参照先（直前の画像）の説明文で置き換える */
function resolveAboveRef(desc: string, refDesc: string): string {
  const r = '「' + refDesc.replace(/[。.\s]+$/, '') + '」';
  return desc
    .replace(/上記|上の(?:蓋|写真|もの)|(?<![右左])上(?=と)/g, r)
    .replace(/同上/g, `${r}と同じ`);
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
  // 「上記のノンカラー。」のような説明の参照先（直近の「上記」でない説明）
  let lastFullDesc = '';

  for (const { url, desc } of pairs) {
    const body = descBody(desc);
    const refersAbove = ABOVE_REF.test(body);
    if (desc.length >= 8 && !refersAbove) lastFullDesc = desc;
    if (desc.length < 8) continue;
    if (imgExcludes.has(url)) continue;
    if (SKIP_TEXT.test(desc)) continue;
    if (EXPLICIT_NONLID.test(body)) continue;
    if (refersAbove && !NONCOLOR_VARIANT.test(body)) continue;
    const isEmblem = EMBLEM_TEXT.test(desc);
    if (isEmblem && emblemKept) continue;
    if (!isEmblem && designCount >= MAX_DESIGNS_PER_MUNI) continue;
    if (COLOR_TEXT.test(desc) && !NONCOLOR_TEXT.test(desc)) continue;

    const imgCache = `data-cache/manho/img/${sha1(url)}.jpg`;
    const img = await fetchWithCache(url, imgCache);
    if (!img || img.length < 5000) continue;
    let stats;
    try {
      stats = await analyzeImage(img);
    } catch {
      continue;
    }
    if (stats.colorFraction > COLOR_FRACTION_MAX) continue;
    // 蓋ではない写真（デザインの元ネタの像・碑・建物・風景など）を除外。
    // 円形（楕円含む）の輪郭が明確ならほぼ蓋。弱い場合は説明文の語彙で判断する
    if (stats.circleScore < CIRCLE_HARD_MIN) continue;
    if (stats.circleScore < CIRCLE_SOFT_MIN && NONLID_TEXT.test(body) && !LID_HINT.test(body)) continue;
    if (hashes.some((h) => hammingHex(h, stats.dhash) <= DHASH_DUP_MAX)) continue;

    hashes.push(stats.dhash);
    let outDesc = cleanDesc(desc);
    if (refersAbove && lastFullDesc) {
      outDesc = resolveAboveRef(outDesc, cleanDesc(lastFullDesc));
    }
    kept.push({ url, kind: isEmblem ? 'emblem' : 'design', desc: outDesc });
    if (isEmblem) emblemKept = true;
    else designCount++;
    if (emblemKept && designCount >= MAX_DESIGNS_PER_MUNI) break;
  }

  if (kept.length === 0) return null;
  return { pref, name: muni.name, gun: muni.gun, page: muni.url, imgs: kept };
}

async function main() {
  const onlyPref = process.argv[2] ? Number(process.argv[2]) : null;
  imgExcludes = new Set(
    Object.keys(JSON.parse(await readFile('scripts/overrides/manhole-img-excludes.json', 'utf8'))),
  );
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
