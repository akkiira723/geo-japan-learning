import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { analyzeImage, hammingHex } from '../lib/image.ts';
import {
  ABOVE_REF,
  cleanDesc,
  descBody,
  ensureManhoCacheDirs,
  fetchManhoImage,
  fetchManhoPage,
  parseIndex,
  parsePairs,
  PREF_INDEX,
  prefIndexUrl,
  resolveAboveRef,
} from '../lib/manhole-parse.ts';

const MAX_DESIGNS_PER_MUNI = 3; // 市章1枚 + デザイン蓋最大3枚
const COLOR_FRACTION_MAX = 0.06;
const DHASH_DUP_MAX = 6;

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

async function processMuni(muni: { name: string; gun: string; url: string }, pref: number): Promise<MuniResult | null> {
  const html = await fetchManhoPage(muni.url);
  if (!html) {
    console.warn(`  ⚠ ページ取得失敗: ${muni.name} ${muni.url}`);
    return null;
  }
  const pairs = parsePairs(html, muni.url);

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

    const img = await fetchManhoImage(url);
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
  await ensureManhoCacheDirs();

  for (const prefStr of Object.keys(PREF_INDEX)) {
    const pref = Number(prefStr);
    if (onlyPref && pref !== onlyPref) continue;
    const resultPath = `data-cache/manho/result/pref-${String(pref).padStart(2, '0')}.json`;
    if (existsSync(resultPath)) {
      console.log(`pref ${pref}: 済み（スキップ）`);
      continue;
    }
    const indexUrl = prefIndexUrl(pref);
    const idxHtml = await fetchManhoPage(indexUrl);
    if (!idxHtml) {
      console.warn(`✗ インデックス取得失敗: pref ${pref}`);
      continue;
    }
    const munis = parseIndex(idxHtml, indexUrl);
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
