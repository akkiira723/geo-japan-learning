import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { parseIndexText, sha1, stripKanaHeading, type IndexLink } from './manhole-parse.ts';
import { lookupUnit, type MuniUnit, type MuniUnitIndex } from './muni-units.ts';
import { normalizeName } from './normalize.ts';

/**
 * マンホール画像の手動選定（scripts/overrides/manhole-selections.json）。
 *
 * - キーは出題単位の市区町村コード（muni-units.ts。政令市は末尾 00）
 * - エントリがある自治体は手動選定が優先され、クロール（data-cache/manho/result）のヒューリスティック選定は使わない
 * - `imgs` が空のエントリ = 「選定時に何も採用せず次へ進んだ」= クイズ・単語帳に出さない
 * - `legacy` が付いた画像は旧市町村（public/data/legacy の id）の蓋として、旧市町村ポリゴンを正解とする別アイテムになる
 */
export interface SelectedImg {
  url: string;
  /** 画像が載っているページ（出典リンク） */
  page: string;
  /** クイズ表示用の説明文（manhole-parse.describePairs の display） */
  desc: string;
  /** 旧市町村の蓋として採用した場合: 旧市町村 id（例 "gci:01301A1968"） */
  legacy?: string;
}

export interface MuniSelection {
  pref: number;
  /** 可読性のための自治体名（キーのコードが正） */
  name: string;
  imgs: SelectedImg[];
}

export interface SelectionFile {
  version: 1;
  munis: Record<string, MuniSelection>;
}

export const SELECTIONS_PATH = 'scripts/overrides/manhole-selections.json';

export async function loadSelections(path = SELECTIONS_PATH): Promise<SelectionFile> {
  if (!existsSync(path)) return { version: 1, munis: {} };
  const raw = JSON.parse(await readFile(path, 'utf8')) as SelectionFile;
  return { version: 1, munis: raw.munis ?? {} };
}

/** コード順にキーを並べて保存（diff を安定させる） */
export async function saveSelections(file: SelectionFile, path = SELECTIONS_PATH): Promise<void> {
  const munis: Record<string, MuniSelection> = {};
  for (const code of Object.keys(file.munis).sort()) munis[code] = file.munis[code];
  await writeFile(path, JSON.stringify({ version: 1, munis }, null, 1) + '\n', 'utf8');
}

export function selectionsForPref(file: SelectionFile, pref: number): Map<string, MuniSelection> {
  const out = new Map<string, MuniSelection>();
  for (const [code, sel] of Object.entries(file.munis)) {
    if (sel.pref === pref) out.set(code, sel);
  }
  return out;
}

// ---- 県インデックスのページを出題単位に紐付ける ----

export interface MuniPage {
  /** インデックス上の表示（「横浜市デザイン１」「三浦市２（上水道）」） */
  title: string;
  url: string;
  /** 自治体名そのもの（＋デザイン N）のページ。規格・上水道・その他等のサブページは false */
  main: boolean;
}

export interface GroupedPages {
  byCode: Map<string, MuniPage[]>;
  /** どの自治体にも紐付かなかったリンク（県ページ・広域・名寄せ失敗） */
  unmatched: IndexLink[];
}

/**
 * 県インデックスの全リンクを自治体（出題単位）ごとにまとめる。
 * まず従来の名寄せ（自治体名＋郡、manhole-fixes.json 適用）、それで決まらないリンクは
 * 「自治体名で始まるタイトル」（横浜市ベイブリッジ・三浦市２（上水道）等）として前方一致で紐付ける。
 */
export function groupIndexLinks(
  links: IndexLink[],
  idx: MuniUnitIndex,
  fixes: Record<string, string | null>,
  prefName: string,
): GroupedPages {
  const byCode = new Map<string, MuniPage[]>();
  const unmatched: IndexLink[] = [];
  const unitsByLen = [...idx.units].sort((a, b) => normalizeName(b.name).length - normalizeName(a.name).length);

  for (const link of links) {
    const title = stripKanaHeading(link.text).replace(/[．.]+$/, '');
    let unit: MuniUnit | undefined;
    let main = false;
    const parsed = parseIndexText(link.text);
    if (parsed) {
      let name = parsed.name;
      const key = `${prefName}|${name}`;
      if (key in fixes) {
        const o = fixes[key];
        if (o === null) {
          unmatched.push(link);
          continue;
        }
        name = o;
      }
      unit = lookupUnit(idx, name, parsed.gun);
      main = !!unit;
    }
    if (!unit) {
      const t = normalizeName(title);
      const paren = normalizeName(title.match(/[（(]([^）)]+)[）)]/)?.[1] ?? '');
      for (const u of unitsByLen) {
        const n = normalizeName(u.name);
        if (!t.startsWith(n)) continue;
        // 同名の町村が別の郡にもある場合は括弧内の郡名で判別
        if (u.gun && (idx.byTown.get(n)?.length ?? 0) > 1 && paren !== normalizeName(u.gun)) continue;
        unit = u;
        break;
      }
    }
    if (!unit) {
      unmatched.push(link);
      continue;
    }
    const pages = byCode.get(unit.code) ?? [];
    pages.push({ title, url: link.url, main });
    byCode.set(unit.code, pages);
  }
  // メインページを先に
  for (const pages of byCode.values()) pages.sort((a, b) => Number(b.main) - Number(a.main));
  return { byCode, unmatched };
}

// ---- 旧市町村タグ ----

export interface LegacyTownRef {
  id: string;
  n: string;
  gun: string;
  kana?: string;
  /** 現在の自治体（「高崎市・藤岡市」「さいたま市岩槻区」のような複数・区付きあり） */
  into: string;
}

/** その自治体に編入・合併された旧市町村（into が自治体名そのもの、または政令市なら「市名+区名」） */
export function legacyTownsForUnit<T extends LegacyTownRef>(unit: MuniUnit, towns: T[]): T[] {
  const n = normalizeName(unit.name);
  return towns.filter((t) =>
    t.into.split(/[・、]/).some((part) => {
      const p = normalizeName(part);
      return p === n || (p.startsWith(n) && /区$/.test(p));
    }),
  );
}

/**
 * 旧市町村の「人口順位」= 合併先の現行自治体の順位（複数の自治体に分かれた場合は最上位）。
 * 人口順位帯の出題で、旧市町村の蓋を合併先と同じ帯に入れるために使う。
 * 合併先が units に無い（県をまたぐ編入など）・順位が無い場合は undefined
 */
export function legacyParentRank(
  town: LegacyTownRef,
  units: MuniUnit[],
  rankOf: (code: string) => number | undefined,
): number | undefined {
  let best: number | undefined;
  for (const u of units) {
    if (legacyTownsForUnit(u, [town]).length === 0) continue;
    const r = rankOf(u.code);
    if (r !== undefined && (best === undefined || r < best)) best = r;
  }
  return best;
}

// ---- クロール結果と手動選定のマージ ----

export interface ImgOut {
  url: string;
  kind: string;
  desc: string;
  /** 画像が載っているページ（省略時はアイテムの page） */
  page?: string;
}

/** クロール（ヒューリスティック）の結果を出題単位ごとにまとめたもの */
export interface HeuristicGroup {
  pages: string[];
  imgs: ImgOut[];
}

export interface MergedCurrent {
  code: string;
  id: string;
  page: string;
  imgs: ImgOut[];
}

export interface MergedLegacy {
  legacyId: string;
  page: string;
  imgs: ImgOut[];
}

/**
 * 自治体ごとに、手動選定があればそれを（空なら除外）、無ければクロール結果を採用する。
 * 旧市町村タグ付きの画像は旧市町村 id ごとにまとめる（複数の現行自治体のページから同じ旧町に付いていても1アイテム）
 */
export function mergeSelections(
  heuristic: Map<string, HeuristicGroup>,
  selections: Map<string, MuniSelection>,
): { current: MergedCurrent[]; legacy: MergedLegacy[] } {
  const current: MergedCurrent[] = [];
  const legacy = new Map<string, MergedLegacy>();
  const codes = [...new Set([...heuristic.keys(), ...selections.keys()])].sort();
  for (const code of codes) {
    const sel = selections.get(code);
    if (sel) {
      const own = sel.imgs.filter((i) => !i.legacy);
      if (own.length > 0) {
        current.push({
          code,
          id: `m${code}`,
          page: own[0].page,
          imgs: own.map((i) => ({ url: i.url, kind: 'design', desc: i.desc, page: i.page })),
        });
      }
      for (const i of sel.imgs) {
        if (!i.legacy) continue;
        const cur = legacy.get(i.legacy) ?? { legacyId: i.legacy, page: i.page, imgs: [] };
        if (!cur.imgs.some((x) => x.url === i.url)) {
          cur.imgs.push({ url: i.url, kind: 'design', desc: i.desc, page: i.page });
        }
        legacy.set(i.legacy, cur);
      }
      continue;
    }
    const h = heuristic.get(code)!;
    const imgs: ImgOut[] = [];
    for (const img of h.imgs) if (!imgs.some((x) => x.url === img.url)) imgs.push(img);
    if (imgs.length === 0) continue;
    current.push({ code, id: sha1(h.pages[0]).slice(0, 10), page: h.pages[0], imgs });
  }
  return { current, legacy: [...legacy.values()] };
}
