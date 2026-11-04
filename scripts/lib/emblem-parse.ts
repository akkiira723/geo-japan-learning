/**
 * ちきページ「市町村章 都道府県別リスト」(http://www.chikipage.net/ctvsymbol/list/<slug>.php) の HTML パーサ。
 *
 * ページ構造:
 *   <th colspan="6">宮城郡</th>                       … セクション見出し（市 / ○○郡 / ○○振興局 / 東京特別区 等）
 *   <img src="gazo.php?dir=miyagi&fn=sendai" alt="仙台市章"><br>仙台市<br>
 *   <img src="gazo1.php?dir=miyagi&fn=izumi" alt="泉市章【消滅】"><br><font color="red">泉市<br></font>
 *   <img src="gazo1.php?dir=miyagi&fn=sendaix" alt="仙台市（旧）章"><br><font color="green">仙台市（旧）<br></font>
 *
 * - alt 末尾の【消滅】が「消滅自治体の章」。
 * - 名前の（旧）はサイト上では「同じ自治体の旧デザイン」（消滅自治体ではない）。（古）（昔）？ も同種の別版。
 *   これらは variant として区別し、クイズには使わない（アプリ内の「（旧）」= 旧市町村 とは意味が違う）。
 * - 「豊田市（旧挙母市共）」のような注記は名前から落として note に残す。
 */
export type EmblemVariant = '旧' | '古' | '昔' | '?';

export interface EmblemEntry {
  /** 直前のセクション見出し（郡名の名寄せに使う） */
  section: string;
  dir: string;
  fn: string;
  /** gazo = 現行章、gazo1 = 消滅章・旧版章 */
  src: 'gazo' | 'gazo1';
  /** 注記（…）を除いた自治体名 */
  name: string;
  /** ページ上の表示名そのまま */
  rawName: string;
  /** 名前に付いていた注記（例: 旧挙母市共） */
  note?: string;
  /** 消滅自治体の章（alt 末尾【消滅】） */
  defunct: boolean;
  /** 旧版・別版の章。null が通常の章 */
  variant: EmblemVariant | null;
}

const TOKEN =
  /<th colspan="6">([^<]*)<\/th>|<img src="(gazo1?)\.php\?dir=(\w+)&(?:amp;)?fn=(\w+)"[^>]*\balt="([^"]*)"[^>]*>\s*<br>\s*(?:<font color="\w+">)?([^<]*?)\s*<br>/g;

function variantOf(rawName: string): EmblemVariant | null {
  if (rawName.includes('（旧）')) return '旧';
  if (rawName.includes('（古）')) return '古';
  if (rawName.includes('（昔）')) return '昔';
  if (/[?？]/.test(rawName)) return '?';
  return null;
}

export function parseEmblemPage(html: string): EmblemEntry[] {
  const out: EmblemEntry[] = [];
  let section = '';
  for (const m of html.matchAll(TOKEN)) {
    if (m[1] !== undefined) {
      section = m[1].trim();
      continue;
    }
    const [, , src, dir, fn, alt, rawNameRaw] = m;
    const rawName = rawNameRaw.trim();
    const notes = [...rawName.matchAll(/（([^）]*)）/g)].map((x) => x[1]);
    const name = rawName.replace(/（[^）]*）/g, '').replace(/[?？]/g, '').trim();
    const variant = variantOf(rawName);
    const note = notes.filter((n) => !['旧', '古', '昔'].includes(n)).join('・') || undefined;
    out.push({
      section,
      dir,
      fn,
      src: src as 'gazo' | 'gazo1',
      name,
      rawName,
      note,
      defunct: /【消滅】\s*$/.test(alt),
      variant,
    });
  }
  return out;
}

/** ページ slug → 都道府県コード（北海道は2ページ）。fetch と build の両方がこの順で回す */
export const EMBLEM_PAGES: [slug: string, pref: number][] = [
  ['hokkaido1', 1], ['hokkaido2', 1], ['aomori', 2], ['iwate', 3], ['miyagi', 4], ['akita', 5],
  ['yamagata', 6], ['fukushima', 7], ['ibaraki', 8], ['tochigi', 9], ['gumma', 10], ['saitama', 11],
  ['chiba', 12], ['tokyo', 13], ['kanagawa', 14], ['niigata', 15], ['toyama', 16], ['ishikawa', 17],
  ['fukui', 18], ['yamanashi', 19], ['nagano', 20], ['gifu', 21], ['shizuoka', 22], ['aichi', 23],
  ['mie', 24], ['shiga', 25], ['kyoto', 26], ['osaka', 27], ['hyogo', 28], ['nara', 29],
  ['wakayama', 30], ['tottori', 31], ['shimane', 32], ['okayama', 33], ['hiroshima', 34], ['yamaguchi', 35],
  ['tokushima', 36], ['kagawa', 37], ['ehime', 38], ['kochi', 39], ['fukuoka', 40], ['saga', 41],
  ['nagasaki', 42], ['kumamoto', 43], ['oita', 44], ['miyazaki', 45], ['kagoshima', 46], ['okinawa', 47],
];

export const EMBLEM_BASE = 'http://www.chikipage.net/ctvsymbol/list/';

/** 取得済み画像のキャッシュパス（dir+src+fn で一意。fn は現行/消滅で重複しうる — 例: 宮城 tomiya） */
export function emblemImageCachePath(e: Pick<EmblemEntry, 'dir' | 'src' | 'fn'>): string {
  return `data-cache/emblems/img/${e.dir}-${e.src}-${e.fn}.png`;
}
