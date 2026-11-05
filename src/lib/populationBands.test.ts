import { describe, expect, it } from 'vitest';
import { bandFile, bandFromOf, bandLabel, POPULATION_BANDS, POPULATION_RANK_MAX } from './populationBands';

describe('POPULATION_BANDS', () => {
  it('1 位から最下位まで 100 位刻みで隙間なく並ぶ', () => {
    expect(POPULATION_BANDS).toHaveLength(18);
    expect(POPULATION_BANDS[0]).toEqual({ from: 1, to: 100 });
    expect(POPULATION_BANDS[1]).toEqual({ from: 101, to: 200 });
    expect(POPULATION_BANDS.at(-1)).toEqual({ from: 1701, to: POPULATION_RANK_MAX });
    POPULATION_BANDS.slice(1).forEach((b, i) => expect(b.from).toBe(POPULATION_BANDS[i].to + 1));
  });
});

describe('bandFile / bandLabel', () => {
  it('開始順位を 4 桁ゼロ埋めしたファイル名になる', () => {
    expect(bandFile(1)).toBe('rank-0001.json');
    expect(bandFile(101)).toBe('rank-0101.json');
    expect(bandFile(1701)).toBe('rank-1701.json');
  });

  it('表示ラベル', () => {
    expect(bandLabel({ from: 1, to: 100 })).toBe('1–100位');
  });
});

describe('bandFromOf', () => {
  it('順位から帯の開始順位を返す', () => {
    expect(bandFromOf(1)).toBe(1);
    expect(bandFromOf(100)).toBe(1);
    expect(bandFromOf(101)).toBe(101);
    expect(bandFromOf(1740)).toBe(1701);
  });

  it('範囲外は undefined', () => {
    expect(bandFromOf(0)).toBeUndefined();
    expect(bandFromOf(1741)).toBeUndefined();
  });
});
