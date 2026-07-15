import { describe, expect, it } from 'vitest';
import { nearestLineId, pxToKm, type LineFeature } from './lineHover';

/** 緯度35の横線（経度 lngFrom〜lngTo）を1本持つ路線 */
function line(id: string, lngFrom: number, lngTo: number, lat = 35): LineFeature {
  return {
    id,
    bbox: [lngFrom, lat, lngTo, lat],
    geom: {
      type: 'MultiLineString',
      coordinates: [
        [
          [lngFrom, lat],
          [lngTo, lat],
        ],
      ],
    },
  };
}

describe('nearestLineId', () => {
  const a = line('1', 139, 140); // 緯度35
  const b = line('2', 139, 140, 35.1); // 約11km北の平行線

  it('しきい値内の最近傍を返す', () => {
    // 線Aの 0.02度北 ≈ 2.2km（線Bへは約9km）
    expect(nearestLineId([a, b], { lat: 35.02, lng: 139.5 }, 3)).toBe('1');
  });

  it('2本の間では近い方を返す', () => {
    // Bに寄った点（Aから約8.9km / Bから約2.2km）
    expect(nearestLineId([a, b], { lat: 35.08, lng: 139.5 }, 10)).toBe('2');
  });

  it('しきい値外なら null', () => {
    expect(nearestLineId([a, b], { lat: 35.02, lng: 139.5 }, 1)).toBeNull();
  });

  it('bbox 外（プリフィルタ圏外）はスキップされ null', () => {
    expect(nearestLineId([a], { lat: 40, lng: 145 }, 5)).toBeNull();
  });

  it('bbox 際でもしきい値ぶんの余白で拾う（端点近傍）', () => {
    // 線Aの西端 (139,35) の西 0.02度 ≈ 1.8km。bbox の外だが余白内
    expect(nearestLineId([a], { lat: 35, lng: 138.98 }, 3)).toBe('1');
  });
});

describe('pxToKm', () => {
  it('ズーム10・緯度35で 12px はおよそ 1.5km', () => {
    const km = pxToKm(12, 10, 35);
    expect(km).toBeGreaterThan(1.0);
    expect(km).toBeLessThan(2.0);
  });

  it('ズームが1上がると半分になる', () => {
    expect(pxToKm(12, 11, 35)).toBeCloseTo(pxToKm(12, 10, 35) / 2, 6);
  });
});
