import { describe, expect, it } from 'vitest';
import {
  groupIndexLinks,
  legacyParentRank,
  legacyTownsForUnit,
  mergeSelections,
  type MuniSelection,
} from './manhole-selection.ts';
import { buildUnitIndex, lookupUnit, seireiCodeOf } from './muni-units.ts';

const idx = buildUnitIndex([
  { code: '14100', name: '横浜市', gun: '' },
  { code: '14210', name: '三浦市', gun: '' },
  { code: '14212', name: '厚木市', gun: '' },
  { code: '14401', name: '愛川町', gun: '愛甲郡' },
  { code: '14402', name: '清川村', gun: '愛甲郡' },
  // 同名町村の判別用（架空）
  { code: '14501', name: '東村', gun: '甲郡' },
  { code: '14502', name: '東村', gun: '乙郡' },
]);

describe('lookupUnit', () => {
  it('市 → 郡+町村 → 町村名の順で引く', () => {
    expect(lookupUnit(idx, '横浜市')?.code).toBe('14100');
    expect(lookupUnit(idx, '愛川町', '愛甲郡')?.code).toBe('14401');
    expect(lookupUnit(idx, '愛川町')?.code).toBe('14401');
  });
  it('同名の町村が複数あるとき郡なしでは決めない', () => {
    expect(lookupUnit(idx, '東村')).toBeUndefined();
    expect(lookupUnit(idx, '東村', '乙郡')?.code).toBe('14502');
  });
});

describe('groupIndexLinks', () => {
  const L = (text: string) => ({ text, url: `https://we-love-manho.com/x/${text}.html` });
  it('自治体名ページはメイン、自治体名で始まるサブページも同じ自治体に紐付ける', () => {
    const g = groupIndexLinks(
      [
        L('横浜市デザイン１'),
        L('横浜市デザイン２'),
        L('横浜市規格・越境等.'),
        L('横浜市ベイブリッジ'),
        L('三浦市.'),
        L('三浦市２（上水道）'),
        L('愛川町（愛甲郡）'),
        L('神奈川県.'),
        L('神奈川県広域'),
      ],
      idx,
      {},
      '神奈川県',
    );
    expect(g.byCode.get('14100')?.map((p) => [p.title, p.main])).toEqual([
      ['横浜市デザイン１', true],
      ['横浜市デザイン２', true],
      ['横浜市規格・越境等', false],
      ['横浜市ベイブリッジ', false],
    ]);
    expect(g.byCode.get('14210')?.map((p) => p.title)).toEqual(['三浦市', '三浦市２（上水道）']);
    expect(g.byCode.get('14401')?.length).toBe(1);
    expect(g.unmatched.map((l) => l.text)).toEqual(['神奈川県.', '神奈川県広域']);
  });
  it('manhole-fixes.json の名前修正と無視（null）を適用する', () => {
    const g = groupIndexLinks([L('厚本市.'), L('清川村（愛甲郡）')], idx, { '神奈川県|厚本市': '厚木市', '神奈川県|清川村': null }, '神奈川県');
    expect(g.byCode.get('14212')?.length).toBe(1);
    expect(g.byCode.has('14402')).toBe(false);
    expect(g.unmatched.map((l) => l.text)).toEqual(['清川村（愛甲郡）']);
  });
  it('同名町村のサブページは括弧内の郡で判別する', () => {
    const g = groupIndexLinks([L('東村その他（乙郡）'), L('東村その他')], idx, {}, '神奈川県');
    expect(g.byCode.get('14502')?.length).toBe(1);
    expect(g.unmatched.map((l) => l.text)).toEqual(['東村その他']);
  });
});

describe('legacyTownsForUnit', () => {
  const towns = [
    { id: 'a', n: '甲町', gun: 'X郡', into: '横浜市' },
    { id: 'b', n: '乙町', gun: 'X郡', into: 'さいたま市岩槻区' },
    { id: 'c', n: '丙町', gun: 'X郡', into: '高崎市・藤岡市' },
    { id: 'd', n: '丁町', gun: 'X郡', into: '横浜町' },
  ];
  it('into が自治体名そのもの・政令市の区・複数自治体の一部、を拾う', () => {
    expect(legacyTownsForUnit({ code: '14100', name: '横浜市', gun: '' }, towns).map((t) => t.id)).toEqual(['a']);
    expect(legacyTownsForUnit({ code: '11100', name: 'さいたま市', gun: '' }, towns).map((t) => t.id)).toEqual(['b']);
    expect(legacyTownsForUnit({ code: '10209', name: '藤岡市', gun: '' }, towns).map((t) => t.id)).toEqual(['c']);
  });
});

describe('legacyParentRank', () => {
  const units = [
    { code: '10202', name: '高崎市', gun: '' },
    { code: '10209', name: '藤岡市', gun: '' },
    { code: '11100', name: 'さいたま市', gun: '' },
    { code: '14100', name: '横浜市', gun: '' },
  ];
  const ranks: Record<string, number> = { '10202': 60, '10209': 500, '11100': 9 };
  const rankOf = (code: string) => ranks[code];
  const town = (into: string) => ({ id: 'x', n: '甲町', gun: 'X郡', into });
  it('合併先の自治体の順位を返す（政令市の区は市の順位）', () => {
    expect(legacyParentRank(town('藤岡市'), units, rankOf)).toBe(500);
    expect(legacyParentRank(town('さいたま市岩槻区'), units, rankOf)).toBe(9);
  });
  it('複数の自治体に分かれた場合は最上位の順位', () => {
    expect(legacyParentRank(town('藤岡市・高崎市'), units, rankOf)).toBe(60);
  });
  it('合併先が県内に無い・順位が無い場合は undefined', () => {
    expect(legacyParentRank(town('中津川市'), units, rankOf)).toBeUndefined();
    expect(legacyParentRank(town('横浜市'), units, rankOf)).toBeUndefined();
  });
});

describe('mergeSelections', () => {
  const heuristic = new Map([
    ['14100', { pages: ['https://x/yokohama.html', 'https://x/yokohama2.html'], imgs: [{ url: 'h1', kind: 'design', desc: 'd1' }, { url: 'h1', kind: 'design', desc: 'dup' }, { url: 'h2', kind: 'emblem', desc: 'd2' }] }],
    ['14210', { pages: ['https://x/miura.html'], imgs: [{ url: 'm1', kind: 'design', desc: 'm' }] }],
    ['14212', { pages: ['https://x/atugi.html'], imgs: [{ url: 'a1', kind: 'design', desc: 'a' }] }],
  ]);
  const selections = new Map<string, MuniSelection>([
    ['14210', { pref: 14, name: '三浦市', imgs: [] }],
    [
      '14212',
      {
        pref: 14,
        name: '厚木市',
        imgs: [
          { url: 's1', page: 'https://x/atugi.html', desc: 's1d' },
          { url: 's2', page: 'https://x/atugi2.html', desc: 's2d', legacy: 'gci:AAA' },
        ],
      },
    ],
    ['14401', { pref: 14, name: '愛川町', imgs: [{ url: 's3', page: 'https://x/aikawa.html', desc: 's3d', legacy: 'gci:AAA' }] }],
  ]);
  const merged = mergeSelections(heuristic, selections);

  it('未選定の自治体はクロール結果を URL 重複なしで使い、id は従来どおり先頭ページの sha1', () => {
    const y = merged.current.find((c) => c.code === '14100')!;
    expect(y.imgs.map((i) => i.url)).toEqual(['h1', 'h2']);
    expect(y.id).toHaveLength(10);
    expect(y.page).toBe('https://x/yokohama.html');
  });
  it('空の選定（何も採用せず次へ）は自治体ごと除外する', () => {
    expect(merged.current.some((c) => c.code === '14210')).toBe(false);
  });
  it('選定済みの自治体はクロール結果を使わず、旧市町村タグなしの画像だけが現行アイテムになる', () => {
    const a = merged.current.find((c) => c.code === '14212')!;
    expect(a.id).toBe('m14212');
    expect(a.imgs).toEqual([{ url: 's1', kind: 'design', desc: 's1d', page: 'https://x/atugi.html' }]);
  });
  it('旧市町村タグ付きの画像は旧市町村 id ごとに1アイテムにまとめる（複数の現行自治体のページ由来でも）', () => {
    expect(merged.legacy).toHaveLength(1);
    expect(merged.legacy[0].legacyId).toBe('gci:AAA');
    expect(merged.legacy[0].imgs.map((i) => i.url)).toEqual(['s2', 's3']);
  });
  it('旧市町村タグだけの自治体は現行アイテムを作らない', () => {
    expect(merged.current.some((c) => c.code === '14401')).toBe(false);
  });
});

describe('seireiCodeOf', () => {
  it('区コードの最小値を 10 の位で切り下げる', () => {
    expect(seireiCodeOf(['14101', '14118', '14105'])).toBe('14100');
    expect(seireiCodeOf(['14131', '14137'])).toBe('14130');
    expect(seireiCodeOf(['27102', '27128'])).toBe('27100');
    expect(seireiCodeOf(['01101'])).toBe('01100');
  });
});
