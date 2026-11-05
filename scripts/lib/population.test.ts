import { describe, expect, it } from 'vitest';
import { groupByBand, isRankedMunicipality, rankMunicipalities, type CensusEntry } from './population.ts';

const entries: CensusEntry[] = [
  { code: '00000', name: '全国', kind: 'a', pop: 126146099 },
  { code: '13000', name: '東京都', kind: 'a', pop: 14047594 },
  { code: '13100', name: '特別区部', kind: '1', pop: 9733276 },
  { code: '01100', name: '札幌市', kind: '1', pop: 1973395 },
  { code: '01101', name: '札幌市中央区', kind: '0', pop: 248680 },
  { code: '13112', name: '世田谷区', kind: '0', pop: 943664 },
  { code: '01202', name: '函館市', kind: '2', pop: 251084 },
  { code: '01303', name: '当別町', kind: '3', pop: 15797 },
  { code: '07543', name: '大熊町', kind: '3', pop: null },
];

describe('isRankedMunicipality', () => {
  it('市・政令市・町村・東京特別区は対象、政令市の区と都道府県は対象外', () => {
    expect(entries.filter(isRankedMunicipality).map((e) => e.name)).toEqual(['札幌市', '世田谷区', '函館市', '当別町', '大熊町']);
  });
});

describe('rankMunicipalities', () => {
  const r = rankMunicipalities(entries);
  it('人口降順で順位を振る', () => {
    expect(r.get('01100')).toEqual({ pop: 1973395, rank: 1 });
    expect(r.get('13112')?.rank).toBe(2);
    expect(r.get('01202')?.rank).toBe(3);
    expect(r.get('01303')?.rank).toBe(4);
  });
  it('人口不明・対象外は順位無し', () => {
    expect(r.has('07543')).toBe(false);
    expect(r.has('01101')).toBe(false);
    expect(r.has('13000')).toBe(false);
    expect(r.has('13100')).toBe(false);
  });
});

describe('groupByBand', () => {
  const g = groupByBand([
    { id: 'c', rank: 150 },
    { id: 'a', rank: 100 },
    { id: 'legacy-of-b', rank: 2 },
    { id: 'b', rank: 2 },
    { id: 'norank' },
    { id: 'last', rank: 1740 },
    { id: 'out', rank: 1741 },
  ]);
  it('100 位刻みの帯に分け、帯の中は順位順（同順位は元の並び）', () => {
    expect(g.get(1)?.map((x) => x.id)).toEqual(['legacy-of-b', 'b', 'a']);
    expect(g.get(101)?.map((x) => x.id)).toEqual(['c']);
    expect(g.get(1701)?.map((x) => x.id)).toEqual(['last']);
  });
  it('空の帯も含む全 18 帯を返し、順位なし・範囲外は含めない', () => {
    expect(g.size).toBe(18);
    expect(g.get(201)).toEqual([]);
    expect([...g.values()].flat()).toHaveLength(5);
  });
});
