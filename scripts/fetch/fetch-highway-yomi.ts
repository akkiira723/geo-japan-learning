import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { facilityCore, facilityKanaCore } from '../lib/highway.ts';
import { kataToHira } from '../lib/yomi.ts';

/**
 * Wikipedia の一覧記事から高速道路施設の読みを取得する（CC BY-SA 4.0）。
 * - 「日本のインターチェンジ一覧 ○行」: IC・JCT・都市高速出入口・ランプを含む箇条書き
 *   `* [[記事名]]（よみ）` / `* [[記事名 (県名)]]（よみ：道路名）`
 * - 「日本のサービスエリア・パーキングエリア一覧」: wikitable 行
 *   `|d||[[相原パーキングエリア|相原PA]]||あいわら||…`
 * OSM の name:ja-Hira が無い施設の読みをこの辞書で補完する（build-highways.ts）。
 */
const API = 'https://ja.wikipedia.org/w/api.php';
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';
const PAGE_DELAY_MS = 1000;

const IC_PAGES = ['あ行', 'か行', 'さ行', 'た行', 'な行', 'は行', 'ま行', 'や-わ行'].map(
  (g) => `日本のインターチェンジ一覧 ${g}`,
);
const SAPA_PAGE = '日本のサービスエリア・パーキングエリア一覧';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchWikitext(title: string, cachePath: string): Promise<string> {
  if (existsSync(cachePath)) {
    console.log(`  ${title}: キャッシュ済み`);
    return readFile(cachePath, 'utf8');
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const url = `${API}?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(title)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        query?: { pages?: Record<string, { revisions?: { slots: { main: { '*': string } } }[] }> };
      };
      const page = Object.values(json.query?.pages ?? {})[0];
      const text = page?.revisions?.[0]?.slots.main['*'];
      if (!text || text.length < 1000) throw new Error('wikitext が取得できません（記事名変更の可能性）');
      await writeFile(cachePath, text, 'utf8');
      console.log(`  ${title}: ${text.length.toLocaleString()} bytes`);
      return text;
    } catch (err) {
      console.warn(`  リトライ ${attempt}/5 (${title}): ${err instanceof Error ? err.message : err}`);
      if (attempt === 5) throw err;
      await sleep(3000 * attempt);
    }
  }
  throw new Error('unreachable');
}

export interface HighwayYomiEntry {
  /** 地名コア（サフィックス除去 + NFKC）。突合キー */
  core: string;
  /** 地名コアのひらがな読み */
  kana: string;
  /** 記事名の曖昧さ回避から取れた都道府県名（例: 千葉県） */
  pref?: string;
  /** 読み併記の道路名ヒント（例: 京葉道路） */
  road?: string;
}

/** 読み文字列 → 地名コアのひらがな。italic('') や括弧注記を除去してから正規化 */
function toKanaCore(raw: string): string {
  const cleaned = raw.replace(/''/g, '').replace(/[（(].*?[）)]/g, '').trim();
  return facilityKanaCore(kataToHira(cleaned.normalize('NFKC')));
}

/** IC 一覧（箇条書き）: `* [[記事名|別名]]（よみ：道路名）…` */
function parseIcList(text: string, out: HighwayYomiEntry[]): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('*')) continue;
    const m = line.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\][\s]*[（(]([^）)]+)[）)]/);
    if (!m) continue;
    const [, title, alias, paren] = m;
    const disambig = title.match(/\(([^)]+)\)\s*$/)?.[1];
    const prefHint = disambig && /[都道府県]$/.test(disambig) ? disambig : undefined;
    // 「貝塚インターチェンジ (阪和自動車道)」のような道路名での曖昧さ回避も道路ヒントに使う
    const roadHint = disambig && !prefHint ? disambig : undefined;
    const baseTitle = title.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const [kanaRaw, roadRaw] = paren.split(/[：:]/);
    const kana = toKanaCore(kanaRaw);
    if (!kana || !/^[ぁ-んー・\s]+$/.test(kana)) continue; // 読み欄でない括弧（仮称等）はスキップ
    const names = new Set([baseTitle, alias?.replace(/\s*\([^)]*\)\s*$/, '').trim()].filter(Boolean) as string[]);
    for (const name of names) {
      // 「高槻ジャンクション・インターチェンジ」のような複合記事名は先頭の施設名で引く
      const core = facilityCore(name.normalize('NFKC').split('・')[0]);
      if (!core) continue;
      out.push({ core, kana, pref: prefHint, road: roadRaw?.trim() || roadHint });
      count++;
    }
  }
  return count;
}

/** SA/PA 一覧（wikitable）: `|d||[[記事名|相原PA]]||あいわら||…` */
function parseSapaList(text: string, out: HighwayYomiEntry[]): number {
  let count = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('|') || line.startsWith('|-') || line.startsWith('|}')) continue;
    const cells = line.split('||');
    const linkIdx = cells.findIndex((c) => c.includes('[['));
    if (linkIdx === -1 || linkIdx + 1 >= cells.length) continue;
    const linkM = cells[linkIdx].match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/);
    if (!linkM) continue;
    const kana = toKanaCore(cells[linkIdx + 1]);
    if (!kana || !/^[ぁ-んー・\s]+$/.test(kana)) continue;
    const [, title, alias] = linkM;
    // 同名 SA/PA は記事名の曖昧さ回避（県名 or 道路名）で区別される
    const disambig = title.match(/\(([^)]+)\)\s*$/)?.[1];
    const prefHint = disambig && /[都道府県]$/.test(disambig) ? disambig : undefined;
    const roadHint = disambig && !prefHint ? disambig : undefined;
    const names = new Set(
      [title.replace(/\s*\([^)]*\)\s*$/, '').trim(), alias?.trim()].filter(Boolean) as string[],
    );
    for (const name of names) {
      const core = facilityCore(name.normalize('NFKC').split('・')[0]);
      if (!core) continue;
      out.push({ core, kana, pref: prefHint, road: roadHint });
      count++;
    }
  }
  return count;
}

async function main() {
  await mkdir('data-cache/yomi', { recursive: true });
  const outPath = 'data-cache/yomi/wikipedia-highway.json';
  if (existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`高速道路読み辞書: キャッシュ済み（${cached.entries.length} 件、スキップ）`);
    return;
  }

  console.log('Wikipedia の IC / SA・PA 一覧を取得中...');
  const entries: HighwayYomiEntry[] = [];
  for (let i = 0; i < IC_PAGES.length; i++) {
    const text = await fetchWikitext(IC_PAGES[i], `data-cache/yomi/wp-ic-${i}.txt`);
    const n = parseIcList(text, entries);
    console.log(`    → ${n} 読み`);
    await sleep(PAGE_DELAY_MS);
  }
  const sapaText = await fetchWikitext(SAPA_PAGE, 'data-cache/yomi/wp-sapa.txt');
  console.log(`    → ${parseSapaList(sapaText, entries)} 読み`);

  if (entries.length < 3000) {
    throw new Error(`抽出件数が少なすぎます（${entries.length} 件）。記事フォーマット変更の可能性`);
  }
  await writeFile(
    outPath,
    JSON.stringify({
      source:
        'Wikipedia「日本のインターチェンジ一覧」「日本のサービスエリア・パーキングエリア一覧」(CC BY-SA 4.0)',
      entries,
    }),
    'utf8',
  );
  console.log(`高速道路読み辞書: ${entries.length} 件 → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
