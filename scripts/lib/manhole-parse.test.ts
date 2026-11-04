import { describe, expect, it } from 'vitest';
import {
  cleanDesc,
  describePairs,
  parseIndex,
  parseIndexLinks,
  parseIndexText,
  parsePairs,
  resolveAboveRef,
} from './manhole-parse.ts';

const INDEX_URL = 'https://we-love-manho.com/kanagawa/kanagawa.html';
const INDEX_HTML = `
<a href="../kanagawa/aikawa/aikawa.html">愛川町（愛甲郡）</a>
<a href="../kanagawa/atugi/atugi.html">厚木市.</a>
<a href="../kanagawa/miura/miurasijyousuidou/miurasijyousuidou.html">三浦市２（上水道）</a>
<a href="../kanagawa/yokohama/yokohama.html">横浜市デザイン１</a>
<a href="../kanagawa/yokohama/kikaku/kikaku.html">横浜市規格・越境等.</a>
<a href="../kanagawa/kenn/kenn.html">神奈川県.</a>
<a href="http://example.com/x.html">外部</a>
<a href="../kanagawa/atugi/atugi.html">厚木市（重複）</a>
`;

describe('parseIndexLinks', () => {
  it('同サイトの .html リンクを重複なく全部返す', () => {
    const links = parseIndexLinks(INDEX_HTML, INDEX_URL);
    expect(links.map((l) => l.text)).toEqual([
      '愛川町（愛甲郡）',
      '厚木市.',
      '三浦市２（上水道）',
      '横浜市デザイン１',
      '横浜市規格・越境等.',
      '神奈川県.',
    ]);
    expect(links[0].url).toBe('https://we-love-manho.com/kanagawa/aikawa/aikawa.html');
  });
});

describe('parseIndexText', () => {
  it('自治体名と郡を分ける', () => {
    expect(parseIndexText('愛川町（愛甲郡）')).toEqual({ name: '愛川町', gun: '愛甲郡' });
    expect(parseIndexText('厚木市.')).toEqual({ name: '厚木市', gun: '' });
    expect(parseIndexText('横浜市デザイン１')).toEqual({ name: '横浜市', gun: '' });
    expect(parseIndexText('あ 愛別町')).toEqual({ name: '愛別町', gun: '' });
  });
  it('自治体を特定できないタイトルは null', () => {
    expect(parseIndexText('三浦市２（上水道）')).toBeNull();
    expect(parseIndexText('横浜市規格・越境等.')).toBeNull();
    expect(parseIndexText('神奈川県.')).toBeNull();
    expect(parseIndexText('横浜市ベイブリッジ')).toBeNull();
  });
});

describe('parseIndex', () => {
  it('クロール対象（自治体ページ）だけを返す', () => {
    expect(parseIndex(INDEX_HTML, INDEX_URL).map((e) => e.name)).toEqual(['愛川町', '厚木市', '横浜市']);
  });
});

const PAGE_URL = 'https://we-love-manho.com/hokkaidou/aibetutyou/aibetutyou.html';
const PAGE_HTML = `
<tr><td><img src="a.jpg" width="404" alt="x"></td>
<td>・汚水用通常型マンホール蓋。<br>キノコの傘に顔がある「あいちゃんマン」が中央を飛んでいます。<br><br>・撮影日：2015年7月19日<br>・撮影者：kanataさん提供</td></tr>
<tr><td><img src="b.jpg" alt="x"></td><td><img src="048.gif">・上記の「うすい」です。<br><br>・撮影日：2018年10月6日</td></tr>
<tr><td><img src="c.jpg" alt="x"></td><td>・亀甲地紋の汚水用通常型マンホール蓋。<br>中央に町章。</td></tr>
`;

describe('parsePairs', () => {
  it('jpg 画像と直後の説明文をペアにし、gif バッジを説明から除く', () => {
    const pairs = parsePairs(PAGE_HTML, PAGE_URL);
    expect(pairs.map((p) => p.url)).toEqual([
      'https://we-love-manho.com/hokkaidou/aibetutyou/a.jpg',
      'https://we-love-manho.com/hokkaidou/aibetutyou/b.jpg',
      'https://we-love-manho.com/hokkaidou/aibetutyou/c.jpg',
    ]);
    expect(pairs[1].desc.startsWith('・上記の「うすい」です。')).toBe(true);
  });
});

describe('cleanDesc / resolveAboveRef / describePairs', () => {
  it('撮影メタを落とし、末尾の「マンホール蓋」を削る', () => {
    expect(cleanDesc('・汚水用通常型マンホール蓋 ・撮影日：2015年7月19日 ・撮影者：kanata')).toBe('汚水用通常型');
  });
  it('「上記」を参照先の説明で置き換える', () => {
    expect(resolveAboveRef('上記の「うすい」です。', '汚水用通常型。')).toBe('「汚水用通常型」の「うすい」です。');
  });
  it('ページ内の順序で参照を解決する', () => {
    const d = describePairs(parsePairs(PAGE_HTML, PAGE_URL));
    expect(d[0].refersAbove).toBe(false);
    expect(d[1].refersAbove).toBe(true);
    expect(d[1].display.startsWith('「汚水用通常型マンホール蓋。 キノコの傘に顔がある')).toBe(true);
    expect(d[2].display).toBe('亀甲地紋の汚水用通常型マンホール蓋。 中央に町章。');
  });
});
