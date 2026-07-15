import type { MultiLineString } from 'geojson';
import { distanceToGeomKm } from './judge';
import type { LatLng } from '../quizzes/types';

/** 国道番号クイズの選択式回答: カーソル/クリック地点から最近傍の路線を引き当てる */

export interface LineFeature {
  id: string;
  /** [west, south, east, north] */
  bbox: [number, number, number, number];
  geom: MultiLineString;
}

const DEG_KM = 111.32;

/** ズームと緯度からピクセル距離を km に換算する（Web メルカトル） */
export function pxToKm(px: number, zoom: number, lat: number): number {
  const metersPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / 2 ** (zoom + 8);
  return (px * metersPerPx) / 1000;
}

/**
 * しきい値 km 以内で最も近い線形の id を返す（なければ null）。
 * bbox をしきい値分ふくらませたプリフィルタで候補を絞ってから距離計算する
 */
export function nearestLineId(
  features: LineFeature[],
  p: LatLng,
  thresholdKm: number,
): string | null {
  const dLat = thresholdKm / DEG_KM;
  const dLng = thresholdKm / (DEG_KM * Math.max(0.2, Math.cos((p.lat * Math.PI) / 180)));
  let bestId: string | null = null;
  let bestKm = thresholdKm;
  for (const f of features) {
    const [w, s, e, n] = f.bbox;
    if (p.lng < w - dLng || p.lng > e + dLng || p.lat < s - dLat || p.lat > n + dLat) continue;
    const d = distanceToGeomKm(p, f.geom);
    if (d <= bestKm) {
      bestKm = d;
      bestId = f.id;
    }
  }
  return bestId;
}
