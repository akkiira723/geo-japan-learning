import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { LatLng, Target } from '../quizzes/types';

const EARTH_RADIUS_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h));
}

/** bbox: [west, south, east, north] (lon/lat) */
export function inBbox(p: LatLng, bbox: [number, number, number, number]): boolean {
  return p.lng >= bbox[0] && p.lat >= bbox[1] && p.lng <= bbox[2] && p.lat <= bbox[3];
}

export interface JudgeResult {
  hit: boolean;
  /** 点ターゲットまたはポリゴン代表点までの距離 */
  distanceKm: number;
}

export function judgeTarget(target: Target, click: LatLng, radiusKm: number): JudgeResult {
  const rep: LatLng = { lat: target.point[0], lng: target.point[1] };
  const distanceKm = haversineKm(rep, click);
  if (target.kind === 'point') {
    return { hit: distanceKm <= radiusKm, distanceKm };
  }
  // polygon: bbox プレフィルタ → point-in-polygon
  if (target.bbox && !inBbox(click, target.bbox)) {
    return { hit: false, distanceKm };
  }
  if (!target.geom) {
    return { hit: distanceKm <= radiusKm, distanceKm };
  }
  const hit = booleanPointInPolygon([click.lng, click.lat], target.geom);
  return { hit, distanceKm };
}

/**
 * 未回答ターゲット群に対して1クリックを判定する。
 * ヒットした中で最も近いターゲットを消費対象として返す（近接同名駅対策）。
 */
export function judgeClick(
  targets: Target[],
  click: LatLng,
  radiusKm: number,
): { hitTarget: Target | null; nearestDistanceKm: number } {
  let hitTarget: Target | null = null;
  let hitDistance = Infinity;
  let nearestDistance = Infinity;
  for (const t of targets) {
    const r = judgeTarget(t, click, radiusKm);
    nearestDistance = Math.min(nearestDistance, r.distanceKm);
    if (r.hit && r.distanceKm < hitDistance) {
      hitTarget = t;
      hitDistance = r.distanceKm;
    }
  }
  return { hitTarget, nearestDistanceKm: nearestDistance };
}
