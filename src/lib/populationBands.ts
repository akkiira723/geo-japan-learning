/**
 * 人口順位帯（100 位刻み）。市章・マンホールのクイズ／単語帳の出題範囲と、
 * データ生成（scripts/）が書き出す帯ファイル rank-XXXX.json で共用する。
 */

/** 2020年国勢調査で人口が公表されている現行の市・東京特別区・町村の数（= 最下位の順位） */
export const POPULATION_RANK_MAX = 1740;
export const POPULATION_BAND_SIZE = 100;

export interface PopulationBand {
  /** 帯の開始順位（1, 101, 201, …）。帯の識別子としても使う */
  from: number;
  to: number;
}

export const POPULATION_BANDS: PopulationBand[] = Array.from(
  { length: Math.ceil(POPULATION_RANK_MAX / POPULATION_BAND_SIZE) },
  (_, i) => ({
    from: i * POPULATION_BAND_SIZE + 1,
    to: Math.min((i + 1) * POPULATION_BAND_SIZE, POPULATION_RANK_MAX),
  }),
);

/** 帯ファイル名（例: 開始順位 101 → "rank-0101.json"） */
export function bandFile(from: number): string {
  return `rank-${String(from).padStart(4, '0')}.json`;
}

export function bandLabel(band: PopulationBand): string {
  return `${band.from}–${band.to}位`;
}

/** 順位が属する帯の開始順位（範囲外は undefined） */
export function bandFromOf(rank: number): number | undefined {
  if (!Number.isInteger(rank) || rank < 1 || rank > POPULATION_RANK_MAX) return undefined;
  return Math.floor((rank - 1) / POPULATION_BAND_SIZE) * POPULATION_BAND_SIZE + 1;
}
