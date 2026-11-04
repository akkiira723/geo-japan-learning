import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { MultiPolygon, Polygon } from 'geojson';
import { PREFECTURES } from '../../src/lib/prefectures.ts';
import { sha1, stripKanaHeading } from './manhole-parse.ts';
import {
  loadSelections,
  mergeSelections,
  selectionsForPref,
  type HeuristicGroup,
  type ImgOut,
  type SelectionFile,
} from './manhole-selection.ts';
import { bboxOf, round5, type MultiCoords } from './muni-geo.ts';
import { loadMuniUnits, lookupUnit } from './muni-units.ts';
import { normalizeName } from './normalize.ts';
import { loadSacDict, resolveMuniYomi, sacCurrentByName, type SacDict, type Yomi } from './yomi.ts';

/**
 * public/data/manholes/pref-XX.json の生成本体。
 * build-manholes.ts（全県）と選定ツールのサーバー（採用のたびに1県だけ再生成）で共用する。
 */

/** fetch-manholes.ts のクロール結果（data-cache/manho/result/pref-XX.json） */
export interface MuniResult {
  pref: number;
  name: string;
  gun: string;
  page: string;
  imgs: { url: string; kind: 'design' | 'emblem'; desc: string }[];
}

export interface OutItem {
  id: string;
  name: string;
  /** 自治体名のひらがな読み（「（旧）」サフィックスは含まない） */
  kana?: string;
  /** 旧市町村のみ: 郡名（同名の旧町村の区別用） */
  gun?: string;
  page: string;
  imgs: ImgOut[];
  /** 旧市町村のみ: 現在の自治体 */
  into?: string;
  /** into の各市区町村の読み */
  intoYomi?: Yomi[];
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

export interface LegacyTown {
  id: string;
  n: string;
  kana?: string;
  gun: string;
  into: string;
  intoYomi?: Yomi[];
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

const legacyCache = new Map<number, LegacyTown[]>();
export async function loadLegacyTowns(pref: number): Promise<LegacyTown[]> {
  let t = legacyCache.get(pref);
  if (!t) {
    const pp = String(pref).padStart(2, '0');
    t = JSON.parse(await readFile(`public/data/legacy/pref-${pp}.json`, 'utf8')).towns as LegacyTown[];
    legacyCache.set(pref, t);
  }
  return t;
}

export interface BuildContext {
  /** manhole-fixes.json: `県名|サイト上の名前` → 正しい自治体名（null = 無視） */
  fixes: Record<string, string | null>;
  sacDict: SacDict;
  muniYomi: Record<string, string>;
  selections: SelectionFile;
}

export async function createBuildContext(): Promise<BuildContext> {
  return {
    fixes: JSON.parse(await readFile('scripts/overrides/manhole-fixes.json', 'utf8')),
    sacDict: await loadSacDict(),
    muniYomi: JSON.parse(await readFile('scripts/overrides/muni-yomi.json', 'utf8')),
    selections: await loadSelections(),
  };
}

export interface PrefBuildResult {
  items: number;
  imgs: number;
  /** 旧市町村アイテム数（手動選定の旧市町村タグ + 旧市町村名ページのフォールバック） */
  legacyCount: number;
  /** 現行自治体にも旧市町村にも名寄せできなかったページ */
  unresolved: string[];
  /** muni-yomi.json に追記が必要な `県番号|自治体名` */
  unresolvedYomi: string[];
}

function legacyOut(town: LegacyTown, id: string, page: string, imgs: ImgOut[]): OutItem {
  return {
    id,
    name: `${town.n}（旧）`,
    kana: town.kana,
    gun: town.gun || undefined,
    page,
    imgs,
    into: town.into,
    intoYomi: town.intoYomi,
    point: [(town.bbox[1] + town.bbox[3]) / 2, (town.bbox[0] + town.bbox[2]) / 2],
    bbox: town.bbox,
    geom:
      town.geom.type === 'Polygon'
        ? { type: 'MultiPolygon', coordinates: [town.geom.coordinates] as MultiCoords }
        : town.geom,
  };
}

/** 1県分を生成して public/data/manholes/pref-XX.json に書く */
export async function buildManholePref(pref: number, ctx: BuildContext): Promise<PrefBuildResult> {
  const pp = String(pref).padStart(2, '0');
  const units = await loadMuniUnits(pref);
  const legacyTowns = await loadLegacyTowns(pref);
  const legacyById = new Map(legacyTowns.map((t) => [t.id, t]));
  const unresolved: string[] = [];
  const unresolvedYomi = new Set<string>();

  // 読み辞書（e-Stat SAC）: 現行自治体の読みを引く。政令市の「市+区」複合名は連結、未解決は muni-yomi.json へ
  const muniKanaOf = (name: string): string | undefined => {
    const ov = ctx.muniYomi[`${pref}|${name}`];
    if (ov) return ov;
    const direct = resolveMuniYomi(ctx.sacDict, pref, name);
    if (direct) return direct.k;
    const m = name.match(/^(.+?市)(.+区)$/);
    if (m) {
      const c = sacCurrentByName(ctx.sacDict, pref, m[1]);
      const w = sacCurrentByName(ctx.sacDict, pref, m[2]);
      if (c && w) return c.kana + w.kana;
    }
    unresolvedYomi.add(`  "${pref}|${name}": ""`);
    return undefined;
  };

  // クロール結果を出題単位ごとにまとめる。現行自治体に名寄せできないページは旧市町村名として扱う（従来どおり）
  const heuristic = new Map<string, HeuristicGroup>();
  const fallbackItems: OutItem[] = [];
  const resultPath = `data-cache/manho/result/pref-${pp}.json`;
  if (existsSync(resultPath)) {
    const munis: MuniResult[] = JSON.parse(await readFile(resultPath, 'utf8'));
    for (const m of munis) {
      const cleanName = stripKanaHeading(m.name);
      const key = `${PREFECTURES[pref]}|${cleanName}`;
      let name = cleanName;
      if (key in ctx.fixes) {
        const o = ctx.fixes[key];
        if (o === null) continue;
        name = o;
      }
      const unit = lookupUnit(units, name, m.gun ?? '');
      if (unit) {
        const g = heuristic.get(unit.code) ?? { pages: [], imgs: [] };
        g.pages.push(m.page);
        g.imgs.push(...m.imgs.map((i) => ({ url: i.url, kind: i.kind, desc: i.desc })));
        heuristic.set(unit.code, g);
        continue;
      }
      const t = normalizeName(name);
      const legacy = legacyTowns.find((l) => normalizeName(l.n) === t);
      if (legacy) {
        fallbackItems.push(legacyOut(legacy, sha1(m.page).slice(0, 10), m.page, m.imgs));
      } else {
        unresolved.push(`${pref} ${key}`);
      }
    }
  }

  const merged = mergeSelections(heuristic, selectionsForPref(ctx.selections, pref));
  const items: OutItem[] = [];
  for (const cur of merged.current) {
    const unit = units.byCode.get(cur.code)!;
    const coords = round5(unit.coords!);
    const bbox = bboxOf(coords);
    items.push({
      id: cur.id,
      name: unit.name,
      kana: muniKanaOf(unit.name),
      page: cur.page,
      imgs: cur.imgs,
      point: [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2],
      bbox,
      geom: { type: 'MultiPolygon', coordinates: coords },
    });
  }
  let legacyCount = 0;
  for (const leg of merged.legacy) {
    const town = legacyById.get(leg.legacyId);
    if (!town) {
      unresolved.push(`${pref} 旧市町村 id が legacy データに無い: ${leg.legacyId}（manhole-selections.json）`);
      continue;
    }
    items.push(legacyOut(town, leg.legacyId, leg.page, leg.imgs));
    legacyCount++;
  }
  items.push(...fallbackItems);
  legacyCount += fallbackItems.length;

  await mkdir('public/data/manholes', { recursive: true });
  await writeFile(`public/data/manholes/pref-${pp}.json`, JSON.stringify({ pref, items }), 'utf8');
  return {
    items: items.length,
    imgs: items.reduce((s, it) => s + it.imgs.length, 0),
    legacyCount,
    unresolved,
    unresolvedYomi: [...unresolvedYomi],
  };
}

/** 全県ファイルを読み直して index.json を書く（1県だけ再生成したあとでも合計が合うように） */
export async function writeManholeIndex(selectedMunis: number): Promise<{ total: number; totalImgs: number; legacyCount: number }> {
  let total = 0, totalImgs = 0, legacyCount = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const p = `public/data/manholes/pref-${String(pref).padStart(2, '0')}.json`;
    if (!existsSync(p)) continue;
    const { items } = JSON.parse(await readFile(p, 'utf8')) as { items: OutItem[] };
    total += items.length;
    for (const it of items) {
      totalImgs += it.imgs.length;
      if (it.into) legacyCount++;
    }
  }
  await writeFile(
    'public/data/manholes/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      totalImgs,
      legacyCount,
      selectedMunis,
      source:
        '日本マンホール蓋学会 (we-love-manho.com) — 画像は同サイトから直接読み込み（再配布なし）。選定: 手動（scripts/overrides/manhole-selections.json）+ 未選定の自治体は自動選定 + 読み仮名: e-Stat 統計LOD 標準地域コード',
    }),
    'utf8',
  );
  return { total, totalImgs, legacyCount };
}
