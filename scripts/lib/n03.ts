import { readFile } from 'node:fs/promises';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { normalizeName } from './normalize.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';
import type { MuniKnowledge } from './soumu-kukaku.ts';

export interface N03Props {
  N03_001: string;
  N03_003: string | null;
  N03_004: string | null;
  N03_007: string;
}

export type N03Feature = Feature<Polygon | MultiPolygon, N03Props>;

export interface PrefIndex {
  features: N03Feature[];
  /** 正規化名 → feature idx 群 */
  byCity: Map<string, number[]>; // 「夕張市」「札幌市中央区」
  bySeirei: Map<string, number[]>; // 政令市名 → 全区
  byGun: Map<string, number[]>;
  byGunTown: Map<string, number[]>; // 「樺戸郡月形町」
  byTown: Map<string, number[]>; // 郡なし町村名
  /** 生のフル市町村名（郡付き町村・市。政令市は市名のみ） */
  muniNames: string[];
  /** 正規化郡名 → 生のフル町村名リスト */
  gunTowns: Map<string, string[]>;
  /** 正規化フル名（町村・市・「市+区」）→ 5桁市区町村コード */
  cityCode: Map<string, string>;
  /** 正規化政令市名 → 生の区名リスト */
  wards: Map<string, string[]>;
}

export const prefCodeByName = new Map(Object.entries(PREFECTURES).map(([c, n]) => [n, Number(c)]));

const prefIndexes = new Map<number, PrefIndex>();

export async function loadPref(prefCd: number): Promise<PrefIndex> {
  let idx = prefIndexes.get(prefCd);
  if (idx) return idx;
  const pp = String(prefCd).padStart(2, '0');
  const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
  const features = gj.features as N03Feature[];
  idx = {
    features,
    byCity: new Map(),
    bySeirei: new Map(),
    byGun: new Map(),
    byGunTown: new Map(),
    byTown: new Map(),
    muniNames: [],
    gunTowns: new Map(),
    cityCode: new Map(),
    wards: new Map(),
  };
  const push = (m: Map<string, number[]>, k: string, i: number) => {
    const a = m.get(k);
    if (a) a.push(i);
    else m.set(k, [i]);
  };
  const pushName = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k);
    if (a) {
      if (!a.includes(v)) a.push(v);
    } else m.set(k, [v]);
  };
  const seenMuni = new Set<string>();
  features.forEach((f, i) => {
    const g3raw = f.properties.N03_003;
    // 支庁・振興局は郡・政令市ではないので無視する
    const isGov = g3raw && /支庁$|振興局$/.test(g3raw);
    const g3 = g3raw && !isGov ? normalizeName(g3raw) : null;
    const g4raw = f.properties.N03_004;
    const g4 = g4raw ? normalizeName(g4raw) : null;
    if (!g4 || !g4raw) return;
    const code5 = f.properties.N03_007;
    if (g3 && g3.endsWith('郡')) {
      push(idx!.byGun, g3, i);
      push(idx!.byGunTown, g3 + g4, i);
      push(idx!.byTown, g4, i);
      const full = g3raw! + g4raw;
      if (!seenMuni.has(full)) {
        seenMuni.add(full);
        idx!.muniNames.push(full);
      }
      pushName(idx!.gunTowns, g3, full);
      idx!.cityCode.set(g3 + g4, code5);
    } else if (g3) {
      // 政令指定都市: N03_003=市名, N03_004=区名
      push(idx!.bySeirei, g3, i);
      push(idx!.byCity, g3 + g4, i); // 「札幌市中央区」形式
      if (!seenMuni.has(g3raw!)) {
        seenMuni.add(g3raw!);
        idx!.muniNames.push(g3raw!);
      }
      pushName(idx!.wards, g3, g4raw);
      idx!.cityCode.set(g3 + g4, code5);
    } else {
      push(idx!.byCity, g4, i);
      push(idx!.byTown, g4, i);
      if (!seenMuni.has(g4raw)) {
        seenMuni.add(g4raw);
        idx!.muniNames.push(g4raw);
      }
      idx!.cityCode.set(g4, code5);
    }
  });
  prefIndexes.set(prefCd, idx);
  return idx;
}

/** 市町村トークン → feature idx 群（東京23区・政令市・郡・郡省略形に対応） */
export function expandToken(idx: PrefIndex, token: string): number[] | null {
  const t = normalizeName(token);
  if (t === '東京23区' || t === '23区') {
    const out: number[] = [];
    idx.features.forEach((f, i) => {
      const cd = Number(f.properties.N03_007);
      if (cd >= 13101 && cd <= 13123) out.push(i);
    });
    return out.length > 0 ? out : null;
  }
  if (idx.bySeirei.has(t)) return idx.bySeirei.get(t)!;
  if (idx.byCity.has(t)) return idx.byCity.get(t)!;
  if (idx.byGun.has(t)) return idx.byGun.get(t)!;
  if (idx.byGunTown.has(t)) return idx.byGunTown.get(t)!;
  // 「◯◯郡△△町」形式: 郡名部分を前方一致で剥がす
  for (const gun of idx.byGun.keys()) {
    if (t.startsWith(gun)) {
      const rest = t.slice(gun.length);
      if (idx.byGunTown.has(gun + rest)) return idx.byGunTown.get(gun + rest)!;
    }
  }
  if (idx.byTown.has(t)) return idx.byTown.get(t)!;
  return null;
}

/**
 * collectMuniClaims 用の市町村名知識。全県を先読みする。
 * 「23区」は東京都の疑似市町村として扱う。
 */
export async function makeMuniKnowledge(): Promise<MuniKnowledge> {
  const byPref = new Map<string, PrefIndex>();
  for (const [cd, name] of Object.entries(PREFECTURES)) {
    byPref.set(name, await loadPref(Number(cd)));
  }
  return {
    muniNames(pref: string): string[] {
      const idx = byPref.get(pref);
      if (!idx) return [];
      return pref === '東京都' ? ['23区', ...idx.muniNames] : idx.muniNames;
    },
    gunTowns(pref: string, gun: string): string[] | null {
      if (!gun.endsWith('郡')) return null;
      return byPref.get(pref)?.gunTowns.get(normalizeName(gun)) ?? null;
    },
  };
}
