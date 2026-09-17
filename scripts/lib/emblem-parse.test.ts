import { describe, expect, it } from 'vitest';
import { parseEmblemPage } from './emblem-parse.ts';

// 宮城県ページ（miyagi.php）の断片 + 注記付きの実例（愛知・北海道）
const HTML = `
<tr class="grayb"><th colspan="6">市</th></tr>
<tr>
<td width="86" align="center">
<img src="gazo.php?dir=miyagi&fn=sendai" width="80" height="80" alt="仙台市章"><br>仙台市<br></td>
<td width="86" align="center" bgcolor="silver">
<img src="gazo1.php?dir=miyagi&fn=sendaix" width="80" height="80" alt="仙台市（旧）章"><br><font color="green">仙台市（旧）<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=miyagi&fn=furukawa" width="80" height="80" alt="古川市章【消滅】"><br><font color="red">古川市<br></font></td>
<td width="86" align="center">
<img src="gazo.php?dir=aichi&amp;fn=toyota" width="80" height="80" alt="豊田市（旧挙母市共）章"><br>豊田市（旧挙母市共）<br></td>
</tr>
<tr class="grayb"><th colspan="6">黒川郡</th></tr>
<tr>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=miyagi&fn=tomiya" width="80" height="80" alt="富谷町章【消滅】"><br><font color="red">富谷町<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=miyagi&fn=wakayanagix" width="80" height="80" alt="若柳町（旧）章【消滅】"><br><font color="red">若柳町（旧）<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=hokkaido&fn=esan" width="80" height="80" alt="恵山町（旧尻岸内町共）章【消滅】"><br><font color="red">恵山町（旧尻岸内町共）<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=niigata&fn=nagaokaxxx" width="80" height="80" alt="長岡市A（旧）？章"><br><font color="red">長岡市A（旧）？<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=saga&fn=sagaxxx" width="80" height="80" alt="佐賀市（昔）章"><br><font color="red">佐賀市（昔）<br></font></td>
<td width="86" align="center" bgcolor="black">
<img src="gazo1.php?dir=hokkaido&fn=oshamambex" width="80" height="80" alt="長万部町（古）章【消滅】"><br><font color="red">長万部町（古）<br></font></td>
<td align="center">　</td>
</tr>`;

describe('parseEmblemPage', () => {
  const entries = parseEmblemPage(HTML);
  const byFn = Object.fromEntries(entries.map((e) => [e.fn, e]));

  it('全セルを拾い、空セルは無視する', () => {
    expect(entries).toHaveLength(10);
  });
  it('現行章: gazo / 消滅無し / variant 無し', () => {
    expect(byFn.sendai).toMatchObject({ section: '市', dir: 'miyagi', src: 'gazo', name: '仙台市', defunct: false, variant: null });
  });
  it('消滅章は alt 末尾の【消滅】で判定し、セクション見出し（郡）を保持する', () => {
    expect(byFn.furukawa).toMatchObject({ src: 'gazo1', name: '古川市', defunct: true, variant: null, section: '市' });
    expect(byFn.tomiya).toMatchObject({ name: '富谷町', defunct: true, section: '黒川郡' });
  });
  it('（旧）はサイト上の旧デザインなので variant=旧（消滅の有無に関わらず）', () => {
    expect(byFn.sendaix).toMatchObject({ name: '仙台市', defunct: false, variant: '旧' });
    expect(byFn.wakayanagix).toMatchObject({ name: '若柳町', defunct: true, variant: '旧' });
  });
  it('（古）（昔）？ も variant として区別する', () => {
    expect(byFn.oshamambex.variant).toBe('古');
    expect(byFn.sagaxxx.variant).toBe('昔');
    expect(byFn.nagaokaxxx.variant).toBe('旧');
    expect(byFn.nagaokaxxx.name).toBe('長岡市A');
  });
  it('「（旧挙母市共）」のような注記は名前から落として note に残す（&amp; 形式の src も可）', () => {
    expect(byFn.toyota).toMatchObject({ dir: 'aichi', name: '豊田市', note: '旧挙母市共', variant: null, defunct: false });
    expect(byFn.esan).toMatchObject({ name: '恵山町', note: '旧尻岸内町共', defunct: true, variant: null });
  });
});
