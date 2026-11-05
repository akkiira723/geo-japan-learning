import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import type { MultiPolygon, Polygon } from 'geojson';
import { EMBLEM_PAGES, emblemImageCachePath, type EmblemEntry } from '../lib/emblem-parse.ts';
import { bboxOf, loadPrefGeo, lookupMuniCoords, round5 } from '../lib/muni-geo.ts';
import { normalizeName } from '../lib/normalize.ts';
import { groupByBand, loadPopRank } from '../lib/population.ts';
import { loadSacDict, resolveMuniYomi, sacByName, type Yomi } from '../lib/yomi.ts';
import { bandFile, POPULATION_BANDS } from '../../src/lib/populationBands.ts';
import { PREFECTURES } from '../../src/lib/prefectures.ts';

/**
 * 市章クイズのデータを組む。
 * - 現行章: N03 ポリゴン（data-cache/geo/muni）に名寄せ。未解決は exit 1 → overrides/emblem-fixes.json
 * - 消滅章: public/data/legacy（1995年10月以降の消滅市町村）に名寄せ。無いものは 1995 年より前の消滅とみなして自動除外
 * - 人口順位: data-cache/population/census2020.json（現行章のみ。SAC で 5 桁コードを引く）
 * - 画像: data-cache/emblems/img → public/data/emblems/img/<id>.png に複製
 * 出力: pref-NN.json（県別・現行+旧）、rank-XXXX.json（人口順位帯 100 位刻み・現行章のみ）、index.json
 */
interface PageResult {
  slug: string;
  pref: number;
  page: string;
  entries: EmblemEntry[];
  excludedVariants: number;
}

interface OutItem {
  id: string;
  pref: number;
  /** 表示名。旧市町村は「○○町（旧）」（アプリ内の旧市町村規約。出典サイトの（旧）とは別） */
  name: string;
  kana?: string;
  /** public/data/ からの相対パス */
  img: string;
  /** 出典ページ URL */
  page: string;
  legacy?: true;
  /** 旧市町村のみ: 郡名（同名の旧町村が同県に複数あるので表示・識別に使う） */
  gun?: string;
  into?: string;
  intoYomi?: Yomi[];
  /** 現行章のみ: 2020年国勢調査 人口順位・人口 */
  rank?: number;
  pop?: number;
  point: [number, number];
  bbox: [number, number, number, number];
  geom: MultiPolygon;
}

interface LegacyTown {
  n: string;
  kana?: string;
  gun: string;
  into: string;
  intoYomi?: Yomi[];
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

const legacyCache = new Map<number, LegacyTown[]>();
async function loadLegacy(pref: number): Promise<LegacyTown[]> {
  let t = legacyCache.get(pref);
  if (!t) {
    const pp = String(pref).padStart(2, '0');
    t = JSON.parse(await readFile(`public/data/legacy/pref-${pp}.json`, 'utf8')).towns;
    legacyCache.set(pref, t!);
  }
  return t!;
}

/** 同名の旧市町村が複数あれば郡（セクション見出し）が一致するものを優先 */
function findLegacy(towns: LegacyTown[], name: string, section: string): LegacyTown | undefined {
  const t = normalizeName(name);
  const cands = towns.filter((l) => normalizeName(l.n) === t);
  if (cands.length <= 1) return cands[0];
  const s = normalizeName(section);
  return cands.find((l) => normalizeName(l.gun) === s) ?? cands[0];
}

function toMultiPolygon(geom: Polygon | MultiPolygon): MultiPolygon {
  return geom.type === 'Polygon' ? { type: 'MultiPolygon', coordinates: [geom.coordinates] } : geom;
}

function center(bbox: [number, number, number, number]): [number, number] {
  return [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
}

async function main() {
  const overrides: Record<string, string | null> = JSON.parse(
    await readFile('scripts/overrides/emblem-fixes.json', 'utf8'),
  );
  const muniYomiOverride: Record<string, string> = JSON.parse(
    await readFile('scripts/overrides/muni-yomi.json', 'utf8'),
  );
  const sacDict = await loadSacDict();
  const { entries: censusEntries, popRank } = await loadPopRank();
  const censusByCode = new Map(censusEntries.map((e) => [e.code, e]));

  const imgDir = 'public/data/emblems/img';
  await mkdir(imgDir, { recursive: true });

  const unresolved: string[] = [];
  const unresolvedYomi = new Set<string>();
  const pre1995: string[] = [];
  const byPref = new Map<number, OutItem[]>();
  /** 県内での重複検出キー → 画像キー（北海道は市が2ページ両方に載る） */
  const seenKeys = new Map<string, string>();
  const usedIds = new Set<string>();
  let excludedVariants = 0;

  for (const [slug, pref] of EMBLEM_PAGES) {
    const resultPath = `data-cache/emblems/result/${slug}.json`;
    if (!existsSync(resultPath)) {
      throw new Error(`${resultPath} がありません。先に fetch-emblems.ts を実行してください`);
    }
    const result: PageResult = JSON.parse(await readFile(resultPath, 'utf8'));
    excludedVariants += result.excludedVariants;
    const geo = await loadPrefGeo(pref);
    const towns = await loadLegacy(pref);
    const items = byPref.get(pref) ?? [];
    byPref.set(pref, items);

    for (const e of result.entries) {
      const key = `${PREFECTURES[pref]}|${e.name}`;
      let name = e.name;
      if (key in overrides) {
        const o = overrides[key];
        if (o === null) continue;
        name = o;
      }
      const id = createHash('sha1').update(`${e.dir}|${e.src}|${e.fn}|${name}`).digest('hex').slice(0, 10);
      const base = { id, pref, img: `emblems/img/${id}.png`, page: result.page };

      let out: OutItem | null = null;
      const coords = e.defunct ? undefined : lookupMuniCoords(geo, name, e.section);
      if (coords) {
        const merged = round5(coords);
        const bbox = bboxOf(merged);
        const kana = muniYomiOverride[`${pref}|${name}`] ?? resolveMuniYomi(sacDict, pref, name)?.k;
        if (!kana) unresolvedYomi.add(`  "${pref}|${name}": ""`);
        // 同名の現行自治体が同県に複数ある場合（北海道の泊村: 古宇郡と国後郡）は人口データがある方を採る
        const pr = sacByName(sacDict, pref, name)
          .filter((s) => s.to === null)
          .map((s) => popRank.get(s.code))
          .find((r) => r !== undefined);
        out = {
          ...base,
          name,
          kana,
          rank: pr?.rank,
          pop: pr?.pop,
          point: center(bbox),
          bbox,
          geom: { type: 'MultiPolygon', coordinates: merged },
        };
      } else {
        const legacy = findLegacy(towns, name, e.section);
        if (legacy) {
          out = {
            ...base,
            name: `${name}（旧）`,
            kana: legacy.kana,
            legacy: true,
            gun: legacy.gun || undefined,
            into: legacy.into,
            intoYomi: legacy.intoYomi,
            point: center(legacy.bbox),
            bbox: legacy.bbox,
            geom: toMultiPolygon(legacy.geom),
          };
        } else if (e.defunct) {
          pre1995.push(`${PREFECTURES[pref]} ${e.section} ${name}`);
        } else {
          unresolved.push(`  "${key}": ""   (${e.section})`);
        }
      }
      if (!out) continue;
      // 同じ自治体が2回載る場合（北海道の市は2ページ両方に載る）は最初の1件だけ使う。
      // 同名の旧町村（群馬県の3つの東村など）は郡で区別する
      const dupKey = `${pref}|${out.name}|${out.gun ?? ''}`;
      const imgKey = `${e.dir}|${e.src}|${e.fn}`;
      const prevImg = seenKeys.get(dupKey);
      if (prevImg !== undefined) {
        if (prevImg !== imgKey) console.warn(`  ⚠ 重複（画像違い）: ${PREFECTURES[pref]} ${out.gun ?? ''}${out.name}（2件目をスキップ）`);
        continue;
      }
      seenKeys.set(dupKey, imgKey);
      if (usedIds.has(id)) throw new Error(`id 衝突: ${id} (${key})`);
      usedIds.add(id);
      await copyFile(emblemImageCachePath(e), `${imgDir}/${id}.png`);
      items.push(out);
    }
  }

  if (unresolved.length > 0) {
    console.error(`✗ 現行自治体に名寄せできない市章が ${unresolved.length} 件あります。`);
    console.error(
      '  scripts/overrides/emblem-fixes.json に以下のエントリを追記して再実行してください（値は正しい自治体名、除外なら null）:',
    );
    console.error(unresolved.join('\n'));
    process.exit(1);
  }
  if (unresolvedYomi.size > 0) {
    console.error(`✗ 読み仮名が解決できない自治体が ${unresolvedYomi.size} 件あります。`);
    console.error('  scripts/overrides/muni-yomi.json に以下のエントリを追記して再実行してください（値はひらがな読み）:');
    console.error([...unresolvedYomi].join('\n'));
    process.exit(1);
  }

  // 前回生成分の不要な画像を消す（img/ は完全な生成物）
  for (const f of await readdir(imgDir)) {
    if (!usedIds.has(f.replace(/\.png$/, ''))) await unlink(`${imgDir}/${f}`);
  }

  let total = 0, currentCount = 0, legacyCount = 0;
  const ranked: OutItem[] = [];
  for (let pref = 1; pref <= 47; pref++) {
    const items = byPref.get(pref) ?? [];
    items.sort(
      (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name, 'ja'),
    );
    total += items.length;
    for (const it of items) {
      if (it.legacy) legacyCount++;
      else currentCount++;
      if (it.rank !== undefined) ranked.push(it);
    }
    await writeFile(
      `public/data/emblems/pref-${String(pref).padStart(2, '0')}.json`,
      JSON.stringify({ pref, items }),
      'utf8',
    );
  }

  ranked.sort((a, b) => a.rank! - b.rank!);
  const rankedSet = new Set(ranked.map((it) => it.rank));
  const missingTop: string[] = [];
  for (const [code, pr] of popRank) {
    if (pr.rank <= 1000 && !rankedSet.has(pr.rank)) {
      missingTop.push(`${pr.rank}位 ${censusByCode.get(code)?.name ?? code}`);
    }
  }
  const byBand = groupByBand(ranked);
  for (const { from, to } of POPULATION_BANDS) {
    await writeFile(
      `public/data/emblems/${bandFile(from)}`,
      JSON.stringify({ from, to, items: byBand.get(from) ?? [] }),
      'utf8',
    );
  }
  // 旧形式（累積 Top100/300/500/1000 用の top-XXXX.json）は使わなくなったので消す
  for (const f of await readdir('public/data/emblems')) {
    if (/^top-\d+\.json$/.test(f)) await unlink(`public/data/emblems/${f}`);
  }

  await writeFile(
    'public/data/emblems/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      currentCount,
      legacyCount,
      rankedCount: ranked.length,
      missingInTop1000: missingTop.length,
      excludedPre1995Count: pre1995.length,
      excludedVariantCount: excludedVariants,
      source:
        '市町村章画像: ちきページ (chikipage.net) 市町村章 都道府県別リスト（複製して配信） + 人口: e-Stat 令和2年国勢調査 + 読み仮名: e-Stat 統計LOD 標準地域コード',
    }),
    'utf8',
  );

  console.log(`✓ ${total} 章（現行 ${currentCount} / 旧市町村 ${legacyCount}、人口順位付き ${ranked.length}）`);
  console.log(
    `  除外: 別版（旧・古・昔）${excludedVariants} 件、1995年以前の消滅（ポリゴン無し）${pre1995.length} 件`,
  );
  if (missingTop.length > 0) {
    console.log(`⚠ 人口上位1000のうち章が無い自治体 ${missingTop.length} 件:`);
    console.log(
      '  ' + missingTop.slice(0, 30).join(', ') + (missingTop.length > 30 ? ` ...ほか ${missingTop.length - 30} 件` : ''),
    );
  }
  await writeFile('data-cache/emblems/excluded-pre1995.txt', pre1995.join('\n'), 'utf8');
  console.log('  1995年以前の消滅の一覧: data-cache/emblems/excluded-pre1995.txt');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
