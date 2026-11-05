import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { bandFromOf, POPULATION_BANDS, POPULATION_RANK_MAX } from '../../src/lib/populationBands.ts';

/**
 * e-Stat 令和2年国勢調査「都道府県・市区町村別の主な結果」（fetch-population.ts が data-cache/population/census2020.json に保存）
 * から現行市区町村の人口順位を作る。
 */
export const CENSUS_CACHE_PATH = 'data-cache/population/census2020.json';
export interface CensusEntry {
  /** JIS 5桁コード（都道府県は "01000"） */
  code: string;
  name: string;
  /** 地域識別コード: a=全国・都道府県, 1=政令指定都市, 0=政令市の区・東京特別区, 2=市, 3=町村 */
  kind: string;
  /** 総人口（秘匿等で数値が無い場合 null） */
  pop: number | null;
}

/**
 * 順位付け対象: 市(2)・政令市(1)・町村(3)・東京特別区(kind 0 かつ 13101〜13123)。
 * 政令市の行政区・都道府県・「13100 特別区部」（kind 1 だが23区の合計行）は対象外
 */
export function isRankedMunicipality(e: CensusEntry): boolean {
  if (e.kind === '1') return e.code !== '13100';
  if (e.kind === '2' || e.kind === '3') return true;
  if (e.kind === '0') {
    const n = Number(e.code);
    return n >= 13101 && n <= 13123;
  }
  return false;
}

export interface PopRank {
  pop: number;
  rank: number;
}

/** code → { pop, rank }（人口降順。人口不明は順位無し） */
export function rankMunicipalities(entries: CensusEntry[]): Map<string, PopRank> {
  const ranked = entries
    .filter((e): e is CensusEntry & { pop: number } => isRankedMunicipality(e) && e.pop !== null)
    .sort((a, b) => b.pop - a.pop || a.code.localeCompare(b.code));
  const out = new Map<string, PopRank>();
  ranked.forEach((e, i) => out.set(e.code, { pop: e.pop, rank: i + 1 }));
  return out;
}

/**
 * 国勢調査キャッシュを読んで code → { pop, rank } を返す（市章・マンホールの build と選定ツールで共用）。
 * 順位の総数はアプリ側の帯定義（src/lib/populationBands.ts）と一致していなければならない
 */
export async function loadPopRank(): Promise<{ entries: CensusEntry[]; popRank: Map<string, PopRank> }> {
  if (!existsSync(CENSUS_CACHE_PATH)) {
    throw new Error(`${CENSUS_CACHE_PATH} がありません。先に tsx scripts/fetch/fetch-population.ts を実行してください`);
  }
  const { entries } = JSON.parse(await readFile(CENSUS_CACHE_PATH, 'utf8')) as { entries: CensusEntry[] };
  const popRank = rankMunicipalities(entries);
  if (popRank.size !== POPULATION_RANK_MAX) {
    throw new Error(
      `人口順位の件数 ${popRank.size} が POPULATION_RANK_MAX (${POPULATION_RANK_MAX}) と一致しません。src/lib/populationBands.ts を更新してください`,
    );
  }
  return { entries, popRank };
}

/**
 * rank を持つ項目を人口順位帯（100 位刻み）に分ける。キーは帯の開始順位で、空の帯も含む全帯を返す。
 * 帯の中は順位の昇順（同順位は元の並びを保つ）。rank が無い・範囲外の項目は捨てる
 */
export function groupByBand<T extends { rank?: number }>(items: T[]): Map<number, T[]> {
  const out = new Map<number, T[]>(POPULATION_BANDS.map((b) => [b.from, []]));
  for (const it of items) {
    const from = it.rank === undefined ? undefined : bandFromOf(it.rank);
    if (from !== undefined) out.get(from)!.push(it);
  }
  for (const list of out.values()) list.sort((a, b) => a.rank! - b.rank!);
  return out;
}
