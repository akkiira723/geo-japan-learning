import { describe, expect, it } from 'vitest';
import { joinWays, lineLengthKm, type OsmWay } from './join-ways.ts';

/** node id 列から way を作る。座標は経度=node id / 10、緯度 35 の単純な横並び */
function way(id: number, nodes: number[]): OsmWay {
  return {
    type: 'way',
    id,
    nodes,
    geometry: nodes.map((n) => ({ lat: 35, lon: n / 10 })),
  };
}

describe('joinWays', () => {
  it('末尾と先頭の node が一致する way を1本に結合し、接続点の重複座標を残さない', () => {
    const chains = joinWays([way(1, [10, 11, 12]), way(2, [12, 13])]);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual([
      [1.0, 35],
      [1.1, 35],
      [1.2, 35],
      [1.3, 35],
    ]);
  });

  it('向きが逆の way は反転して結合する', () => {
    // way2 は 14→12 と逆向きに描かれているが、端点 12 でつながる
    const chains = joinWays([way(1, [10, 12]), way(2, [14, 12])]);
    expect(chains).toHaveLength(1);
    expect(chains[0]).toEqual([
      [1.0, 35],
      [1.2, 35],
      [1.4, 35],
    ]);
  });

  it('先頭側にも伸ばす', () => {
    const chains = joinWays([way(2, [12, 13]), way(1, [10, 12])]);
    expect(chains).toHaveLength(1);
    expect(chains[0].map((c) => c[0])).toEqual([1.0, 1.2, 1.3]);
  });

  it('つながらない way は別チェーンになる', () => {
    const chains = joinWays([way(1, [10, 11]), way(2, [20, 21])]);
    expect(chains).toHaveLength(2);
  });

  it('三叉路では片方だけを取り込み、残りは別チェーンとして出力される（way の消失なし）', () => {
    // node 12 に3本が集まる
    const ways = [way(1, [10, 12]), way(2, [12, 13]), way(3, [12, 14])];
    const chains = joinWays(ways);
    expect(chains).toHaveLength(2);
    const totalPoints = ways.reduce((n, w) => n + w.nodes.length, 0);
    const chainPoints = chains.reduce((n, c) => n + c.length, 0);
    // 結合1箇所につき重複座標が1点消える
    expect(chainPoints).toBe(totalPoints - 1);
  });
});

describe('lineLengthKm', () => {
  it('経度1度（緯度35）はおよそ91km', () => {
    const km = lineLengthKm([
      [139, 35],
      [140, 35],
    ]);
    expect(km).toBeGreaterThan(89);
    expect(km).toBeLessThan(93);
  });
});
