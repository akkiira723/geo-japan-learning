import { mkdir, readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import { feature as topoFeature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { normalizeName } from '../lib/normalize.ts';
import { loadPref, expandToken, prefCodeByName } from '../lib/n03.ts';
import { loadClaims, computeSplitMunis, type SplitMuni } from '../lib/areacode-claims.ts';
import type { SubToken } from '../lib/soumu-kukaku.ts';

type Ring = [number, number][];
type PolyCoords = Ring[];
type MultiCoords = PolyCoords[];

interface OutArea {
  code: string;
  munis: string[];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

function toMulti(geom: Polygon | MultiPolygon): MultiCoords {
  return geom.type === 'Polygon' ? [geom.coordinates as PolyCoords] : (geom.coordinates as MultiCoords);
}

function round5(coords: MultiCoords): MultiCoords {
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

/** Douglas-Peucker。始点を固定し閉環のまま間引く */
function simplifyRing(ring: Ring, tol: number): Ring {
  const closed = ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1];
  const pts = closed ? ring.slice(0, -1) : ring;
  if (pts.length <= 4) return ring;
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  const segDist = (p: [number, number], a: [number, number], b: [number, number]) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };
  while (stack.length > 0) {
    const [i, j] = stack.pop()!;
    let maxD = -1;
    let maxK = -1;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j]);
      if (d > maxD) {
        maxD = d;
        maxK = k;
      }
    }
    if (maxD > tol) {
      keep[maxK] = 1;
      stack.push([i, maxK], [maxK, j]);
    }
  }
  keep[pts.length - 1] = 1;
  const out: Ring = [];
  for (let k = 0; k < pts.length; k++) if (keep[k]) out.push(pts[k]);
  if (closed) out.push([out[0][0], out[0][1]]);
  return out;
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

/** 小地域由来のジオメトリの間引き: DP 簡略化 + 微小リング除去（N03 s0010 相当の粒度へ） */
function simplifyMulti(coords: MultiCoords, tol: number): MultiCoords {
  const MIN_RING_AREA = 5e-7; // ≒ 数千 m^2
  const out: MultiCoords = [];
  for (const poly of coords) {
    const rings: PolyCoords = [];
    for (let r = 0; r < poly.length; r++) {
      const simp = simplifyRing(poly[r], tol);
      if (simp.length < 4 || ringArea(simp) < MIN_RING_AREA) {
        if (r === 0) break; // 外環が消えたらポリゴンごと捨てる
        continue; // 穴は捨てる
      }
      rings.push(simp);
    }
    if (rings.length > 0) out.push(rings);
  }
  return out;
}

function bboxOf(coords: MultiCoords): [number, number, number, number] {
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

// ---------------------------------------------------------------------------
// 小地域（町丁・字等）

interface ChochoProps {
  S_NAME: string | null;
  HCODE: number;
  X_CODE: number;
  Y_CODE: number;
}

type ChochoFeature = Feature<Polygon | MultiPolygon, ChochoProps>;

const chochoCache = new Map<string, ChochoFeature[]>();

async function loadChocho(code5: string): Promise<ChochoFeature[]> {
  let fc = chochoCache.get(code5);
  if (fc) return fc;
  const topo = JSON.parse(
    await readFile(`data-cache/geo/chocho/r2ka${code5}.topojson`, 'utf8'),
  ) as Topology;
  const obj = topo.objects.town as GeometryCollection<ChochoProps>;
  const collection = topoFeature(topo, obj) as FeatureCollection<Polygon | MultiPolygon, ChochoProps>;
  fc = collection.features.filter((f) => f.geometry);
  chochoCache.set(code5, fc);
  return fc;
}

// --- 旧市町村（歴史的行政区域 2000-10-01 断面）フォールバック
// 「石越町」のように、合併後の小地域名に旧町名の痕跡が残らないケースは
// 旧市町村ポリゴンに重心が含まれる小地域を拾う。

interface LegacyTown {
  name: string; // N03_004（例: 石越町）
  geom: Polygon | MultiPolygon;
}

let legacyByPref: Map<string, LegacyTown[]> | null = null;

async function loadLegacy(): Promise<Map<string, LegacyTown[]>> {
  if (legacyByPref) return legacyByPref;
  legacyByPref = new Map();
  for (const snap of ['20001001', '19951001']) {
    const topo = JSON.parse(
      await readFile(`data-cache/geo/legacy/jp_city_${snap}.c.topojson`, 'utf8'),
    ) as Topology;
    const obj = topo.objects.city as GeometryCollection<{ N03_001: string; N03_004: string | null }>;
    const fc = topoFeature(topo, obj) as FeatureCollection<
      Polygon | MultiPolygon,
      { N03_001: string; N03_004: string | null }
    >;
    for (const f of fc.features) {
      if (!f.geometry || !f.properties.N03_004) continue;
      let arr = legacyByPref.get(f.properties.N03_001);
      if (!arr) legacyByPref.set(f.properties.N03_001, (arr = []));
      arr.push({ name: f.properties.N03_004, geom: f.geometry });
    }
  }
  return legacyByPref;
}

function pointInRing(x: number, y: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInGeom(x: number, y: number, geom: Polygon | MultiPolygon): boolean {
  for (const poly of toMulti(geom)) {
    // 偶奇規則: 外環+穴をまとめて数える
    let count = 0;
    for (const ring of poly) if (pointInRing(x, y, ring)) count++;
    if (count % 2 === 1) return true;
  }
  return false;
}

const CHOME_TAIL = /^[一二三四五六七八九十]+丁目$/;

/** 照合用の小地域名正規化: 「新磯野（一）一丁目」→新磯野一丁目、「徳地大字小古祖」→徳地小古祖 */
function normSname(s: string): string {
  return normalizeName(s)
    .replace(/（[^）]*）/g, '')
    .replace(/大字/g, '');
}

interface MatchCtx {
  features: ChochoFeature[];
  pref: string;
  legacy: Map<string, LegacyTown[]>;
}

/**
 * 名前候補（例: [醍醐一ノ切町, 一ノ切町]）に該当する feature idx 群。
 * 手前の段で1件でも当たればそこで確定する:
 *  1. 完全一致 or 「name+◯丁目」
 *  2. 前方一致（S_NAME が name で始まる）
 *  3. 「字」を無視した完全/前方一致（「天売字相影」= 天売相影）
 *  4. 後方一致（S_NAME「土成町秋月」= 秋月 / name「黒瀬町市飯田」の末尾 = S_NAME「市飯田」）
 *  5. 旧市町村ポリゴン（名前が旧町村名。重心が含まれる小地域を採用）
 */
function matchNames(ctx: MatchCtx, rawNames: string[]): number[] {
  const names = rawNames.map((n) => normalizeName(n).replace(/大字/g, ''));
  const snames = ctx.features.map((f) => (f.properties.S_NAME ? normSname(f.properties.S_NAME) : null));

  const collect = (pred: (s: string, n: string) => boolean): number[] => {
    const out: number[] = [];
    snames.forEach((s, i) => {
      if (s !== null && names.some((n) => pred(s, n))) out.push(i);
    });
    return out;
  };

  // 1. 完全一致 / 丁目
  let m = collect((s, n) => s === n || (s.startsWith(n) && CHOME_TAIL.test(s.slice(n.length))));
  if (m.length > 0) return m;
  // 2. 前方一致
  m = collect((s, n) => s.startsWith(n));
  if (m.length > 0) return m;
  // 3. 字を無視
  const noAza = (v: string) => v.replace(/字/g, '');
  m = collect((s, n) => {
    const sx = noAza(s), nx = noAza(n);
    return sx === nx || sx.startsWith(nx);
  });
  if (m.length > 0) return m;
  // 4. 後方一致（S_NAME 側が長い場合と name 側が長い場合の両方）
  m = collect((s, n) => s.length > n.length && s.endsWith(n));
  if (m.length > 0) return m;
  {
    // name の末尾に S_NAME が一致する場合は最長の S_NAME だけ採用（「黒瀬町市飯田」に「飯田」ではなく「市飯田」）
    let best = 0;
    snames.forEach((s) => {
      if (s !== null && s.length >= 2 && names.some((n) => n.length > s.length && n.endsWith(s)))
        best = Math.max(best, s.length);
    });
    if (best > 0) {
      m = collect((s, n) => s.length === best && n.length > s.length && n.endsWith(s));
      if (m.length > 0) return m;
    }
  }
  // 5. 旧市町村ポリゴン
  for (const name of names) {
    const towns = (ctx.legacy.get(ctx.pref) ?? []).filter((t) => normalizeName(t.name) === name);
    if (towns.length === 0) continue;
    const out: number[] = [];
    ctx.features.forEach((f, i) => {
      const { X_CODE: x, Y_CODE: y } = f.properties;
      if (typeof x === 'number' && typeof y === 'number' && towns.some((t) => pointInGeom(x, y, t.geom))) out.push(i);
    });
    if (out.length > 0) return out;
  }
  return [];
}

/**
 * 包含/除外リストの1項目に該当する feature idx 群。
 * 入れ子修飾（「醍醐（一ノ切町…に限る。）」「岩田町（三丁目を除く。）」）は
 * 親名+子名の連結名（なければ子名単独）で照合する。
 * override 値の「旧:◯◯町」は旧市町村ポリゴンでの照合を強制する。
 */
function matchItem(
  ctx: MatchCtx,
  item: SubToken,
  unresolved: string[],
  ctxKey: string,
  overrides: Record<string, string[] | null>,
  usedOverrides: Set<string>,
): Set<number> {
  const resolve = (key: string, candidates: string[]): number[] => {
    let names = candidates;
    if (key in overrides) {
      usedOverrides.add(key);
      const ov = overrides[key];
      if (ov === null) return [];
      names = ov;
    }
    const legacyNames = names.filter((n) => n.startsWith('旧:')).map((n) => n.slice(2));
    const plainNames = names.filter((n) => !n.startsWith('旧:'));
    const out: number[] = [];
    if (plainNames.length > 0) out.push(...matchNames(ctx, plainNames));
    for (const ln of legacyNames) {
      const towns = (ctx.legacy.get(ctx.pref) ?? []).filter((t) => normalizeName(t.name) === normalizeName(ln));
      ctx.features.forEach((f, i) => {
        const { X_CODE: x, Y_CODE: y } = f.properties;
        if (typeof x === 'number' && typeof y === 'number' && towns.some((t) => pointInGeom(x, y, t.geom)))
          out.push(i);
      });
    }
    if (out.length === 0) unresolved.push(key);
    return out;
  };

  if (!item.mod) return new Set(resolve(`${ctxKey}|${item.name}`, [item.name]));
  if (item.mod.type === 'only') {
    const out = new Set<number>();
    for (const child of item.mod.items)
      for (const i of resolve(`${ctxKey}|${item.name + child.name}`, [item.name + child.name, child.name]))
        out.add(i);
    return out;
  }
  // except: 親の範囲から子を除く
  const base = new Set(resolve(`${ctxKey}|${item.name}`, [item.name]));
  for (const child of item.mod.items)
    for (const i of resolve(`${ctxKey}|${item.name + child.name}`, [item.name + child.name, child.name]))
      base.delete(i);
  return base;
}

// ---------------------------------------------------------------------------

async function main() {
  const { claims } = await loadClaims();
  const splits = await computeSplitMunis(claims);
  const splitKeys = new Set(splits.map((s) => `${s.pref}|${s.muni}`));

  const chochoOverrides: Record<string, string[] | null> = JSON.parse(
    await readFile('scripts/overrides/areacode-chocho-fixes.json', 'utf8'),
  );
  const usedChochoOverrides = new Set<string>();

  const unresolved: string[] = [];
  const warnings: string[] = [];

  // バケット: `${code}|${prefCd}` → 表示名とジオメトリ片
  const buckets = new Map<
    string,
    { code: string; prefCd: number; geoms: MultiCoords[]; munis: string[]; hasChocho: boolean }
  >();
  const addGeom = (
    code: string,
    prefCd: number,
    geoms: MultiCoords[],
    displayName?: string,
    fromChocho = false,
  ) => {
    const key = `${code}|${prefCd}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { code, prefCd, geoms: [], munis: [], hasChocho: false }));
    b.geoms.push(...geoms);
    if (fromChocho) b.hasChocho = true;
    if (displayName && !b.munis.includes(displayName)) b.munis.push(displayName);
  };

  // --- 単一局番の市町村: N03 ポリゴンをそのまま使う
  for (const [pref, byMuni] of claims) {
    for (const [muni, codeSpecs] of byMuni) {
      if (splitKeys.has(`${pref}|${muni}`)) continue;
      const code = [...codeSpecs.keys()][0];
      const prefCd = prefCodeByName.get(pref)!;
      const idx = await loadPref(prefCd);
      const found = expandToken(idx, muni);
      if (!found) {
        unresolved.push(`${code} ${pref}|${muni} (N03 に該当なし)`);
        continue;
      }
      const display = muni === '23区' ? '東京23区' : muni;
      addGeom(code, prefCd, found.map((i) => toMulti(idx.features[i].geometry)), display);
    }
  }

  // --- 分割市町村: 小地域で切り分け
  for (const s of splits) {
    await buildSplitMuni(s, addGeom, unresolved, warnings, chochoOverrides, usedChochoOverrides);
  }

  const unusedOv = Object.keys(chochoOverrides).filter((k) => !usedChochoOverrides.has(k));
  if (unusedOv.length > 0) console.warn(`⚠ 使われていない chocho override: ${unusedOv.join(', ')}`);
  warnings.forEach((w) => console.warn('⚠ ' + w));

  if (unresolved.length > 0) {
    console.error(`\n✗ 小地域の名寄せ未解決 ${[...new Set(unresolved)].length} 件:`);
    [...new Set(unresolved)].forEach((u) => console.error('  ' + u));
    console.error('\nscripts/overrides/areacode-chocho-fixes.json に追記してください。');
    process.exit(1);
  }

  // --- union してチャンク出力
  const outByPref = new Map<number, OutArea[]>();
  const codePrefs = new Map<string, Set<number>>();
  for (const b of buckets.values()) {
    let merged: MultiCoords;
    try {
      merged = polygonClipping.union(
        b.geoms[0] as never,
        ...(b.geoms.slice(1) as never[]),
      ) as MultiCoords;
    } catch {
      console.warn(`⚠ union 失敗: ${b.code} pref${b.prefCd} → 連結にフォールバック`);
      merged = b.geoms.flat();
    }
    // 小地域（未簡略化で高密度）を含むエリアは N03 s0010 相当まで間引く
    if (b.hasChocho) merged = simplifyMulti(merged, 1e-4);
    merged = round5(merged);

    const area: OutArea = {
      code: b.code,
      munis: b.munis,
      bbox: bboxOf(merged),
      geom: { type: 'MultiPolygon', coordinates: merged },
    };
    const arr = outByPref.get(b.prefCd);
    if (arr) arr.push(area);
    else outByPref.set(b.prefCd, [area]);
    let cp = codePrefs.get(b.code);
    if (!cp) codePrefs.set(b.code, (cp = new Set()));
    cp.add(b.prefCd);
  }

  await mkdir('public/data/areacodes', { recursive: true });
  let total = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const areas = (outByPref.get(pref) ?? []).sort((a, b) => a.code.localeCompare(b.code));
    total += areas.length;
    await writeFile(
      `public/data/areacodes/pref-${String(pref).padStart(2, '0')}.json`,
      JSON.stringify({ pref, areas }),
      'utf8',
    );
  }
  await writeFile(
    'public/data/areacodes/index.json',
    JSON.stringify({
      version: 2,
      generatedAt: new Date().toISOString(),
      total,
      codeCount: codePrefs.size,
      crossPrefCodes: Object.fromEntries(
        [...codePrefs.entries()].filter(([, s]) => s.size > 1).map(([c, s]) => [c, [...s].sort((a, b) => a - b)]),
      ),
      source:
        '総務省「市外局番の一覧」PDF + 国土数値情報 N03 (japan-topography s0010) + 国勢調査2020小地域 (Geoshape)',
      note: '番号区画は市区町村単位で解決し、複数局番に分割される市区町村は町丁・字等（小地域）単位で切り分けた近似。',
    }),
    'utf8',
  );

  console.log(`✓ ${codePrefs.size} 局番 / ${total} エリア行を47チャンクに出力`);
  const cross = [...codePrefs.entries()].filter(([, s]) => s.size > 1);
  console.log(`県またぎ局番: ${cross.map(([c]) => c).join(', ') || 'なし'}`);
}

async function buildSplitMuni(
  s: SplitMuni,
  addGeom: (code: string, prefCd: number, geoms: MultiCoords[], displayName?: string, fromChocho?: boolean) => void,
  unresolved: string[],
  warnings: string[],
  overrides: Record<string, string[] | null>,
  usedOverrides: Set<string>,
) {
  const idx = await loadPref(s.prefCd);
  const { plan } = s;
  const display = (code: string) => (code === plan.defaultCode ? s.muni : `${s.muni}（一部）`);

  if (s.wards) {
    // 政令市: 区ごとに処理
    for (const ward of s.wards) {
      const scope = plan.scopes.get(ward);
      const scopeDefault = plan.wardWholes.get(ward) ?? plan.defaultCode;
      const hasItems =
        scope && [...scope.perCode.values()].some((e) => e.incl.length > 0 || e.excl.length > 0);
      if (!hasItems) {
        // 丸ごとどれかの局番
        if (!scopeDefault) {
          unresolved.push(`${s.pref}${s.muni}${ward}: どの局番にも割り当てられない`);
          continue;
        }
        const feats = idx.byCity.get(normalizeName(s.muni) + normalizeName(ward));
        if (!feats) {
          unresolved.push(`${s.pref}${s.muni}${ward}: N03 に区ポリゴンなし`);
          continue;
        }
        addGeom(scopeDefault, s.prefCd, feats.map((i) => toMulti(idx.features[i].geometry)), display(scopeDefault));
        continue;
      }
      const code5 = s.chochoNeeds.get(ward)!;
      await assignChocho(s, ward, code5, scopeDefault, addGeom, unresolved, warnings, overrides, usedOverrides, display);
    }
  } else {
    const code5 = s.chochoNeeds.get('');
    if (!code5) {
      unresolved.push(`${s.pref}${s.muni}: 小地域データの割当がない`);
      return;
    }
    await assignChocho(s, '', code5, plan.defaultCode, addGeom, unresolved, warnings, overrides, usedOverrides, display);
  }
}

async function assignChocho(
  s: SplitMuni,
  scopeName: string,
  code5: string,
  scopeDefault: string | null,
  addGeom: (code: string, prefCd: number, geoms: MultiCoords[], displayName?: string, fromChocho?: boolean) => void,
  unresolved: string[],
  warnings: string[],
  overrides: Record<string, string[] | null>,
  usedOverrides: Set<string>,
  display: (code: string) => string,
) {
  const features = await loadChocho(code5);
  const scope = s.plan.scopes.get(scopeName)!;
  const ctx: MatchCtx = { features, pref: s.pref, legacy: await loadLegacy() };
  const ctxKey = `${s.pref}|${s.muni}${scopeName}`;

  const incl = new Map<string, Set<number>>();
  const excl = new Map<string, Set<number>>();
  for (const [code, e] of scope.perCode) {
    const iSet = new Set<number>();
    for (const item of e.incl)
      for (const i of matchItem(ctx, item, unresolved, ctxKey, overrides, usedOverrides)) iSet.add(i);
    incl.set(code, iSet);
    const xSet = new Set<number>();
    for (const item of e.excl)
      for (const i of matchItem(ctx, item, unresolved, ctxKey, overrides, usedOverrides)) xSet.add(i);
    excl.set(code, xSet);
  }

  const byCode = new Map<string, number[]>();
  features.forEach((f, i) => {
    const assigned: string[] = [];
    for (const [code, iSet] of incl) {
      if (iSet.has(i) && code !== scopeDefault) assigned.push(code);
    }
    if (assigned.length === 0) {
      if (scopeDefault && !excl.get(scopeDefault)?.has(i)) {
        assigned.push(scopeDefault);
      } else if (scopeDefault && incl.get(scopeDefault)?.has(i)) {
        assigned.push(scopeDefault);
      }
    }
    if (assigned.length === 0) {
      unresolved.push(`${ctxKey}|(未割当) ${f.properties.S_NAME ?? '(無名)'}`);
      return;
    }
    if (assigned.length > 1) {
      warnings.push(`${ctxKey}: 「${f.properties.S_NAME}」が複数局番 ${assigned.join('/')} に該当`);
    }
    for (const code of assigned) {
      let arr = byCode.get(code);
      if (!arr) byCode.set(code, (arr = []));
      arr.push(i);
    }
  });

  for (const [code, idxs] of byCode) {
    addGeom(code, s.prefCd, idxs.map((i) => toMulti(features[i].geometry)), display(code), true);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
