import { describe, expect, it } from 'vitest';
import { maskName, matchesAnswer, normalizeAnswer } from './textAnswer';

describe('normalizeAnswer', () => {
  it('前後の空白を除去する', () => {
    expect(normalizeAnswer(' 甲府市 ')).toBe('甲府市');
  });

  it('全角空白・内部の空白も除去する', () => {
    expect(normalizeAnswer('甲府　市')).toBe('甲府市');
  });

  it('空文字はそのまま', () => {
    expect(normalizeAnswer('')).toBe('');
  });
});

describe('maskName', () => {
  it('末尾の 市/町/村 を残して他をマスクする', () => {
    expect(maskName('北広島市')).toBe('〇〇〇市');
    expect(maskName('上峰町')).toBe('〇〇町');
    expect(maskName('大玉村')).toBe('〇〇村');
  });

  it('ひらがな交じりの名前もマスクする', () => {
    expect(maskName('みやき町')).toBe('〇〇〇町');
  });

  it('政令市の区付きは 市 と 区 の両方を残す', () => {
    expect(maskName('さいたま市岩槻区')).toBe('〇〇〇〇市〇〇区');
  });

  it('名前の途中の 市 はマスクされる', () => {
    expect(maskName('廿日市市')).toBe('〇〇〇市');
  });

  it('接尾辞がない名前は全マスク', () => {
    expect(maskName('東京')).toBe('〇〇');
  });

  it('1文字の名前は全マスク（接尾辞だけを晒さない）', () => {
    expect(maskName('市')).toBe('〇');
  });
});

describe('matchesAnswer', () => {
  it('完全一致で正解', () => {
    expect(matchesAnswer('北広島市', '北広島市')).toBe(true);
  });

  it('空白入りの入力も一致する', () => {
    expect(matchesAnswer(' 北広島市 ', '北広島市')).toBe(true);
  });

  it('接尾辞抜きは不正解', () => {
    expect(matchesAnswer('北広島', '北広島市')).toBe(false);
  });

  it('別の市町村名は不正解', () => {
    expect(matchesAnswer('広島市', '北広島市')).toBe(false);
  });

  it('空入力は不正解', () => {
    expect(matchesAnswer('', '北広島市')).toBe(false);
    expect(matchesAnswer('  ', '北広島市')).toBe(false);
  });

  it('区付きの正解はフル表記で正解', () => {
    expect(matchesAnswer('さいたま市岩槻区', 'さいたま市岩槻区')).toBe(true);
  });

  it('区付きの正解は市名だけでも正解', () => {
    expect(matchesAnswer('さいたま市', 'さいたま市岩槻区')).toBe(true);
  });

  it('区付きの正解に区名だけは不正解', () => {
    expect(matchesAnswer('岩槻区', 'さいたま市岩槻区')).toBe(false);
  });
});
