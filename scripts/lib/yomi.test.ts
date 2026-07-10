import { describe, expect, it } from 'vitest';
import { buildSacDict, sacAt, sacByName, sacCurrentByName, uniqueKana, type SacEntry } from './yomi.ts';

const entries: SacEntry[] = [
  // 北広島町（広島県・現行）と 広島町（北海道・1996年に北広島市へ）— 同字圏の別自治体
  { code: '34369', ja: '北広島町', kana: 'きたひろしまちょう', from: '2005-02-01', to: null, cls: 'Town' },
  { code: '01234', ja: '広島町', kana: 'ひろしまちょう', from: '1970-04-01', to: '1996-09-01', cls: 'Town' },
  { code: '01234', ja: '北広島市', kana: 'きたひろしまし', from: '1996-09-01', to: null, cls: 'City' },
  // 府中市: 東京と広島で同名・同読み
  { code: '13206', ja: '府中市', kana: 'ふちゅうし', from: '1970-04-01', to: null, cls: 'City' },
  { code: '34208', ja: '府中市', kana: 'ふちゅうし', from: '1970-04-01', to: null, cls: 'City' },
  // 表記ゆれ（ヶ/ケ）の突合確認用
  { code: '12227', ja: '鎌ケ谷市', kana: 'かまがやし', from: '1971-09-01', to: null, cls: 'City' },
];
const dict = buildSacDict(entries);

describe('sacAt', () => {
  it('スナップショット日時点で有効なエントリを引く', () => {
    expect(sacAt(dict, '01234', '1995-01-01')?.kana).toBe('ひろしまちょう');
    expect(sacAt(dict, '01234', '2000-01-01')?.kana).toBe('きたひろしまし');
  });
  it('失効日当日は次の期間に切り替わる', () => {
    expect(sacAt(dict, '01234', '1996-09-01')?.kana).toBe('きたひろしまし');
  });
  it('未知のコードは undefined', () => {
    expect(sacAt(dict, '99999', '2000-01-01')).toBeUndefined();
  });
});

describe('sacCurrentByName', () => {
  it('現行有効のエントリだけ引く', () => {
    expect(sacCurrentByName(dict, 34, '北広島町')?.kana).toBe('きたひろしまちょう');
    expect(sacCurrentByName(dict, 1, '広島町')).toBeUndefined();
  });
  it('県番号で絞る（同名の他県自治体を拾わない）', () => {
    expect(sacCurrentByName(dict, 13, '府中市')?.code).toBe('13206');
    expect(sacCurrentByName(dict, 34, '府中市')?.code).toBe('34208');
  });
  it('表記ゆれ（ヶ/ケ）を吸収する', () => {
    expect(sacCurrentByName(dict, 12, '鎌ヶ谷市')?.kana).toBe('かまがやし');
  });
});

describe('sacByName / uniqueKana', () => {
  it('消滅自治体も含めて引ける', () => {
    const hits = sacByName(dict, 1, '広島町');
    expect(uniqueKana(hits)).toBe('ひろしまちょう');
  });
  it('該当なしは null', () => {
    expect(uniqueKana(sacByName(dict, 1, '存在しない町'))).toBeNull();
  });
  it('読みが割れたら null（要 override）', () => {
    const ambiguous = buildSacDict([
      { code: '01111', ja: '大和町', kana: 'やまとちょう', from: '1970-04-01', to: '1980-01-01', cls: 'Town' },
      { code: '01112', ja: '大和町', kana: 'たいわちょう', from: '1970-04-01', to: '1990-01-01', cls: 'Town' },
    ]);
    expect(uniqueKana(sacByName(ambiguous, 1, '大和町'))).toBeNull();
  });
});
