import { describe, expect, it } from 'vitest';
import { manholeLearnId, migrateLearnedManholes } from './manhole';

const img = (url: string) => ({ url, kind: 'design' });
const sapporo = { id: 'm01100', imgs: [img('https://example.com/a.jpg'), img('https://example.com/b.jpg')] };
const hakodate = { id: 'm01202', imgs: [img('https://example.com/c.jpg')] };

describe('migrateLearnedManholes', () => {
  it('旧形式の自治体 id を、その自治体の全画像に展開する', () => {
    const next = migrateLearnedManholes(new Set(['m01100']), [sapporo, hakodate]);
    expect([...next].sort()).toEqual(['m01100|https://example.com/a.jpg', 'm01100|https://example.com/b.jpg']);
  });

  it('画像単位の id と、読み込んでいない範囲の旧 id はそのまま残す', () => {
    const kept = manholeLearnId(hakodate, hakodate.imgs[0]);
    const next = migrateLearnedManholes(new Set(['m01100', 'm13101', kept]), [sapporo, hakodate]);
    expect(next.has('m13101')).toBe(true);
    expect(next.has(kept)).toBe(true);
    expect(next.has('m01100')).toBe(false);
    expect(next.size).toBe(4);
  });

  it('変換するものが無ければ同じ Set を返す', () => {
    const learned = new Set([manholeLearnId(sapporo, sapporo.imgs[0])]);
    expect(migrateLearnedManholes(learned, [sapporo, hakodate])).toBe(learned);
  });
});
