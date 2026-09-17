import { readFile } from 'node:fs/promises';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { normalizeName } from './normalize.ts';

/**
 * N03（国土数値情報 行政区域）の県別 GeoJSON キャッシュ（data-cache/geo/muni/）を
 * 自治体名で引ける索引にする。マンホール・市章など「自治体名 → 現行ポリゴン」の名寄せで共用する。
 */
export type Ring = [number, number][];
export type PolyCoords = Ring[];
export type MultiCoords = PolyCoords[];

interface N03Props {
  N03_003: string | null;
  N03_004: string | null;
}

export function toMulti(geom: Polygon | MultiPolygon): MultiCoords {
  return geom.type === 'Polygon' ? [geom.coordinates as PolyCoords] : (geom.coordinates as MultiCoords);
}

/** 座標を小数5桁に丸め、丸めで潰れた連続重複点を除く */
export function round5(coords: MultiCoords): MultiCoords {
  return coords.map((poly) =>
    poly.map((ring) => {
      const out: Ring = [];
      for (const [x, y] of ring) {
        const p: [number, number] = [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5];
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
      }
      return out;
    }),
  );
}

export function bboxOf(coords: MultiCoords): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const poly of coords)
    for (const ring of poly)
      for (const [x, y] of ring) {
        if (x < w) w = x;
        if (y < s) s = y;
        if (x > e) e = x;
        if (y > n) n = y;
      }
  const r = (v: number) => Math.round(v * 1e4) / 1e4;
  return [r(w), r(s), r(e), r(n)];
}

export interface PrefGeoIndex {
  /** 政令市名 → 全区を合算したポリゴン */
  bySeirei: Map<string, MultiCoords>;
  /** 市名 / 「政令市名+区名」 → ポリゴン */
  byCity: Map<string, MultiCoords>;
  /** 「郡名+町村名」 → ポリゴン */
  byGunTown: Map<string, MultiCoords>;
  /** 町村名・区名（郡・市を除いた末尾要素） → ポリゴン */
  byTown: Map<string, MultiCoords>;
}

const prefGeo = new Map<number, PrefGeoIndex>();

/** 県の N03 を読み込み、normalizeName 済みのキーで引ける索引を返す（プロセス内キャッシュ） */
export async function loadPrefGeo(pref: number): Promise<PrefGeoIndex> {
  let idx = prefGeo.get(pref);
  if (idx) return idx;
  const pp = String(pref).padStart(2, '0');
  const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
  idx = { bySeirei: new Map(), byCity: new Map(), byGunTown: new Map(), byTown: new Map() };
  const add = (m: Map<string, MultiCoords>, k: string, coords: MultiCoords) => {
    m.set(k, (m.get(k) ?? []).concat(coords));
  };
  for (const f of gj.features as Feature<Polygon | MultiPolygon, N03Props>[]) {
    const g3raw = f.properties.N03_003;
    const g3 = g3raw && !/支庁$|振興局$/.test(g3raw) ? normalizeName(g3raw) : null;
    const g4 = f.properties.N03_004 ? normalizeName(f.properties.N03_004) : null;
    if (!g4) continue;
    const coords = toMulti(f.geometry);
    if (g3 && g3.endsWith('郡')) {
      add(idx.byGunTown, g3 + g4, coords);
      add(idx.byTown, g4, coords);
    } else if (g3) {
      add(idx.bySeirei, g3, coords); // 政令市全体
      add(idx.byCity, g3 + g4, coords); // 「仙台市青葉区」
      add(idx.byTown, g4, coords); // 「青葉区」
    } else {
      add(idx.byCity, g4, coords);
      add(idx.byTown, g4, coords);
    }
  }
  prefGeo.set(pref, idx);
  return idx;
}

/**
 * 自治体表示名から現行ポリゴンを引く。市 → 政令市 → 郡+町村（gun があるとき）→ 町村名 の順。
 * gun には「○○郡」以外（振興局・「市」見出し等）が来ても無視する
 */
export function lookupMuniCoords(idx: PrefGeoIndex, name: string, gun = ''): MultiCoords | undefined {
  const t = normalizeName(name);
  const gunT = normalizeName(gun);
  return (
    idx.byCity.get(t) ??
    idx.bySeirei.get(t) ??
    (gunT.endsWith('郡') ? idx.byGunTown.get(gunT + t) : undefined) ??
    idx.byTown.get(t)
  );
}
