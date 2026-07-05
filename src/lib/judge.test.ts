import { describe, expect, it } from 'vitest';
import type { Target } from '../quizzes/types';
import { haversineKm, inBbox, judgeClick, judgeTarget } from './judge';

const TOKYO = { lat: 35.6812, lng: 139.7671 };
const OSAKA = { lat: 34.7025, lng: 135.4959 };

describe('haversineKm', () => {
  it('東京駅–大阪駅間は約403km', () => {
    const d = haversineKm(TOKYO, OSAKA);
    expect(d).toBeGreaterThan(395);
    expect(d).toBeLessThan(410);
  });

  it('同一点は0', () => {
    expect(haversineKm(TOKYO, TOKYO)).toBe(0);
  });
});

describe('judgeTarget (point)', () => {
  const target: Target = {
    id: 't1',
    label: '東京駅',
    kind: 'point',
    point: [TOKYO.lat, TOKYO.lng],
  };

  it('半径内なら hit', () => {
    const near = { lat: 35.69, lng: 139.70 }; // 新宿あたり(約6km)
    const r = judgeTarget(target, near, 20);
    expect(r.hit).toBe(true);
    expect(r.distanceKm).toBeLessThan(10);
  });

  it('半径外なら miss', () => {
    const r = judgeTarget(target, OSAKA, 20);
    expect(r.hit).toBe(false);
  });
});

describe('judgeTarget (polygon)', () => {
  // 経度139〜140 / 緯度35〜36 の正方形
  const target: Target = {
    id: 'p1',
    label: 'テストエリア',
    kind: 'polygon',
    point: [35.5, 139.5],
    bbox: [139, 35, 140, 36],
    geom: {
      type: 'Polygon',
      coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]],
    },
  };

  it('ポリゴン内なら hit（半径に依存しない）', () => {
    const r = judgeTarget(target, { lat: 35.5, lng: 139.5 }, 0);
    expect(r.hit).toBe(true);
  });

  it('bbox 内でもポリゴン外なら miss', () => {
    const r = judgeTarget(target, { lat: 36.5, lng: 139.5 }, 0);
    expect(r.hit).toBe(false);
  });

  it('bbox 外は即 miss', () => {
    const r = judgeTarget(target, { lat: 34, lng: 135 }, 0);
    expect(r.hit).toBe(false);
  });
});

describe('judgeClick（複数ターゲットの最近傍消費）', () => {
  const a: Target = { id: 'a', label: 'A', kind: 'point', point: [35.0, 139.0] };
  const b: Target = { id: 'b', label: 'B', kind: 'point', point: [35.1, 139.0] }; // Aの約11km北

  it('両方の判定圏内なら近い方を消費する', () => {
    // A に少し寄った中間点。半径50kmなら両方 hit しうる
    const click = { lat: 35.04, lng: 139.0 };
    const { hitTarget } = judgeClick([a, b], click, 50);
    expect(hitTarget?.id).toBe('a');
  });

  it('どれにも当たらなければ null と最寄り距離を返す', () => {
    const { hitTarget, nearestDistanceKm } = judgeClick([a, b], { lat: 36.0, lng: 139.0 }, 10);
    expect(hitTarget).toBeNull();
    expect(nearestDistanceKm).toBeGreaterThan(90);
  });

  it('残りターゲットが空なら null', () => {
    const { hitTarget } = judgeClick([], { lat: 35, lng: 139 }, 100);
    expect(hitTarget).toBeNull();
  });
});

describe('inBbox', () => {
  it('境界値を含む', () => {
    expect(inBbox({ lat: 35, lng: 139 }, [139, 35, 140, 36])).toBe(true);
    expect(inBbox({ lat: 34.99, lng: 139 }, [139, 35, 140, 36])).toBe(false);
  });
});
