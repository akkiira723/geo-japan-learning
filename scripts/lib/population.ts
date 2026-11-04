/**
 * e-Stat 令和2年国勢調査「都道府県・市区町村別の主な結果」（fetch-population.ts が data-cache/population/census2020.json に保存）
 * から現行市区町村の人口順位を作る。
 */
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
