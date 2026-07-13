import { describe, expect, it } from 'vitest';
import { roundLine4, simplifyLine, type Line } from './simplify.ts';

describe('simplifyLine', () => {
  it('直線上の中間点を除去する', () => {
    const line: Line = [
      [0, 0],
      [1, 0.00001],
      [2, 0],
      [3, 0.00002],
      [4, 0],
    ];
    expect(simplifyLine(line, 0.001)).toEqual([
      [0, 0],
      [4, 0],
    ]);
  });

  it('許容誤差を超える屈曲点は残す', () => {
    const line: Line = [
      [0, 0],
      [1, 0.5],
      [2, 0],
    ];
    expect(simplifyLine(line, 0.001)).toEqual(line);
  });

  it('始点・終点は必ず残す', () => {
    const line: Line = [
      [0, 0],
      [0.1, 0],
      [0.2, 0],
    ];
    const out = simplifyLine(line, 10);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([0.2, 0]);
  });

  it('2点以下はそのまま返す', () => {
    const line: Line = [
      [139.7, 35.6],
      [139.8, 35.7],
    ];
    expect(simplifyLine(line, 0.001)).toEqual(line);
  });
});

describe('roundLine4', () => {
  it('4桁に丸める', () => {
    expect(roundLine4([[139.76868123, 35.63494987]])).toEqual([[139.7687, 35.6349]]);
  });

  it('丸めで一致した連続点を除去する', () => {
    const line: Line = [
      [139.70001, 35.60001],
      [139.70002, 35.60002],
      [139.7001, 35.6001],
    ];
    expect(roundLine4(line)).toEqual([
      [139.7, 35.6],
      [139.7001, 35.6001],
    ]);
  });
});
