import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { MultiLineString, MultiPolygon, Polygon } from 'geojson';
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
  /** 点ターゲットまでの距離、ポリゴン境界への最短距離（内側なら0）、または線形への最短距離 */
  distanceKm: number;
}

const DEG_KM = 111.32; // 緯度1度あたりの距離

/** 点と線分の最短距離（局所平面近似）。飛び地を含む全パーツで正しい距離を返すための下請け */
function distToSegmentKm(p: LatLng, ax: number, ay: number, bx: number, by: number): number {
  const kx = DEG_KM * Math.cos((p.lat * Math.PI) / 180); // 経度1度あたりの km
  const px = (p.lng - ax) * kx;
  const py = (p.lat - ay) * DEG_KM;
  const vx = (bx - ax) * kx;
  const vy = (by - ay) * DEG_KM;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * vx + py * vy) / len2));
  const dx = px - t * vx;
  const dy = py - t * vy;
  return Math.sqrt(dx * dx + dy * dy);
}

/** ポリゴン境界（飛び地・穴を含む全リング）または線形（全パーツ）への最短距離 */
export function distanceToGeomKm(p: LatLng, geom: Polygon | MultiPolygon | MultiLineString): number {
  // Polygon のリング列と MultiLineString の線列は同じネスト深度なので同一ループで処理できる
  const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
  let min = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const d = distToSegmentKm(p, ring[i][0], ring[i][1], ring[i + 1][0], ring[i + 1][1]);
        if (d < min) min = d;
      }
    }
  }
  return min;
}

export function judgeTarget(target: Target, click: LatLng, radiusKm: number): JudgeResult {
  const rep: LatLng = { lat: target.point[0], lng: target.point[1] };
  if (target.kind === 'point') {
    const distanceKm = haversineKm(rep, click);
    return { hit: distanceKm <= radiusKm, distanceKm };
  }
  if (!target.geom) {
    const distanceKm = haversineKm(rep, click);
    return { hit: distanceKm <= radiusKm, distanceKm };
  }
  // line: 線形への最短距離が半径内なら hit（点ターゲットと同じ距離判定を線に対して行う）
  if (target.kind === 'line' || target.geom.type === 'MultiLineString') {
    const distanceKm = distanceToGeomKm(click, target.geom);
    return { hit: distanceKm <= radiusKm, distanceKm };
  }
  // polygon: bbox 内なら point-in-polygon、距離は境界への最短距離（代表点ではなく）
  const inside =
    (!target.bbox || inBbox(click, target.bbox)) &&
    booleanPointInPolygon([click.lng, click.lat], target.geom);
  return { hit: inside, distanceKm: inside ? 0 : distanceToGeomKm(click, target.geom) };
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
