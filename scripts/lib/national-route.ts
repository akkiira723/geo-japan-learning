import { readFile } from 'node:fs/promises';

/** 一般国道の選別ロジック（fetch-routes / build-route-lines で共用） */

export interface RouteRelationTags {
  ref?: string;
  name?: string;
  network?: string;
}

export interface OsmRelation {
  type: string;
  id: number;
  tags?: RouteRelationTags;
  members?: { type: string; ref: number; role: string }[];
}

export interface RouteFixes {
  /** 誤選別されたリレーションの除外。キーは "r<リレーションID>"、値は理由メモ */
  exclude: Record<string, string>;
  /** リレーション未整備・タグ不備の路線への手動追加。キーは路線番号、値はリレーションID配列 */
  addRelations: Record<string, number[]>;
}

/** 一般国道の存在する路線番号（1〜507 から欠番 59〜100・109〜111・214〜216 を除いた459） */
export function expectedRouteNumbers(): Set<number> {
  const s = new Set<number>();
  for (let n = 1; n <= 507; n++) s.add(n);
  for (let n = 59; n <= 100; n++) s.delete(n);
  for (const n of [109, 110, 111, 214, 215, 216]) s.delete(n);
  return s;
}

const EXPECTED = expectedRouteNumbers();

/**
 * リレーションが一般国道（現道・バイパス含む）なら路線番号を返す。
 * 数値 ref だけでは県道と区別できないため、network=JP:national か
 * name「国道N号」のどちらかを国道の証拠として要求する。旧道リレーションは除外。
 */
export function routeNumberOf(tags: RouteRelationTags | undefined): number | null {
  if (!tags) return null;
  const name = tags.name ?? '';
  if (name.includes('旧道') || name.includes('旧国道')) return null;
  const national = tags.network === 'JP:national' || /^国道\d+号/.test(name);
  if (!national) return null;
  const ref = tags.ref && /^\d+$/.test(tags.ref) ? Number(tags.ref) : null;
  const fromName = name.match(/^国道(\d+)号/)?.[1];
  const n = ref ?? (fromName ? Number(fromName) : null);
  return n !== null && EXPECTED.has(n) ? n : null;
}

export async function loadRouteFixes(): Promise<RouteFixes> {
  return JSON.parse(await readFile('scripts/overrides/route-fixes.json', 'utf8'));
}
