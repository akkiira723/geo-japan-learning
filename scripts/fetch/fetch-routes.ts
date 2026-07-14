import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { loadRouteFixes, routeNumberOf, type OsmRelation } from '../lib/national-route.ts';

/**
 * 一般国道（1〜507号、欠番除く459路線）の線形を OSM Overpass から取得する。
 * 3ステージ構成:
 *   A. route=road リレーション全件のタグ → 国道リレーションを選別
 *   B. 選別リレーションのメンバー（way ID 対応表。スーパーリレーションは追加パスで展開）
 *   C. メンバー way の線形を ID バッチで out geom（["highway"] フィルタで
 *      フェリー・渡船区間の海上 way を機械的に除外する）
 * キャッシュ無効化は data-cache/routes/ を削除（overrides/route-fixes.json 編集後も同様）。
 */

/** 混雑・レート制限（429/504）に備えて複数の Overpass インスタンスをローテーションする */
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
/** overpass-api.de のレート制限（数クエリ/分）を踏まないためのバッチ間ウェイト */
const BATCH_DELAY_MS = 8000;
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';

/** 国道リレーション一覧（タグのみなので全国一括でも軽い） */
const QUERY_RELATIONS = `
[out:json][timeout:600];
area["ISO3166-1"="JP"][admin_level=2]->.jp;
relation["type"="route"]["route"="road"](area.jp);
out tags;`;

const RELS_BATCH_SIZE = 100;
const queryRelsBatch = (relIds: number[]) => `
[out:json][timeout:300];
rel(id:${relIds.join(',')});
out body;`;

const WAYS_BATCH_SIZE = 2000;
const queryWaysBatch = (wayIds: number[]) => `
[out:json][timeout:300];
way(id:${wayIds.join(',')})["highway"];
out geom;`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface OverpassResponse {
  elements: unknown[];
  remark?: string;
}

async function fetchOverpass(label: string, query: string, cachePath: string): Promise<number> {
  if (existsSync(cachePath)) {
    const cached: OverpassResponse = JSON.parse(await readFile(cachePath, 'utf8'));
    console.log(`${label}: キャッシュ済み（${cached.elements.length} 要素、スキップ）`);
    return cached.elements.length;
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    const endpoint = ENDPOINTS[(attempt - 1) % ENDPOINTS.length];
    try {
      console.log(`${label}: 取得中… (${endpoint})`);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': USER_AGENT,
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(360_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as OverpassResponse;
      // remark はタイムアウト・メモリ超過の警告。空レスポンスも「済み」に見える事故を防ぐため書かない
      if (json.remark) throw new Error(`Overpass remark: ${json.remark}`);
      if (!Array.isArray(json.elements) || json.elements.length === 0) {
        throw new Error('elements が空');
      }
      await writeFile(cachePath, JSON.stringify(json), 'utf8');
      console.log(`${label}: ${json.elements.length} 要素 → ${cachePath}`);
      return json.elements.length;
    } catch (err) {
      console.warn(`  リトライ ${attempt}/5: ${err instanceof Error ? err.message : err}`);
      if (attempt === 5) throw err;
      await sleep(8000 * attempt);
    }
  }
  throw new Error('unreachable');
}

/** relations.json + overrides から国道リレーション ID を選別する */
async function selectRelationIds(): Promise<number[]> {
  const raw = JSON.parse(await readFile('data-cache/routes/relations.json', 'utf8'));
  const fixes = await loadRouteFixes();
  const excluded = new Set(
    Object.keys(fixes.exclude).map((k) => Number(k.replace(/^r/, ''))),
  );
  const ids = new Set<number>();
  for (const el of raw.elements as OsmRelation[]) {
    if (excluded.has(el.id)) continue;
    if (routeNumberOf(el.tags) !== null) ids.add(el.id);
  }
  for (const relIds of Object.values(fixes.addRelations)) {
    for (const id of relIds) if (!excluded.has(id)) ids.add(id);
  }
  console.log(`選別: 国道リレーション ${ids.size} 件`);
  return [...ids].sort((a, b) => a - b);
}

/** リレーション ID バッチをフェッチして Map に取り込む */
async function fetchRelBatches(
  ids: number[],
  partPrefix: string,
  byId: Map<number, OsmRelation>,
): Promise<void> {
  for (let i = 0; i < ids.length; i += RELS_BATCH_SIZE) {
    const batch = ids.slice(i, i + RELS_BATCH_SIZE);
    const part = `data-cache/routes/${partPrefix}-${String(i / RELS_BATCH_SIZE).padStart(3, '0')}.json`;
    await fetchOverpass(
      `${partPrefix} ${i / RELS_BATCH_SIZE + 1}/${Math.ceil(ids.length / RELS_BATCH_SIZE)}`,
      queryRelsBatch(batch),
      part,
    );
    const json = JSON.parse(await readFile(part, 'utf8'));
    for (const el of json.elements as OsmRelation[]) {
      if (el.type === 'relation') byId.set(el.id, el);
    }
    await sleep(BATCH_DELAY_MS);
  }
}

/** 選別リレーションのメンバーを取得。relation メンバー（スーパーリレーション）は追加パスで展開 */
async function fetchMembers(): Promise<void> {
  const outPath = 'data-cache/routes/members.json';
  if (existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`メンバー: キャッシュ済み（${cached.elements.length} リレーション、スキップ）`);
    return;
  }
  const ids = await selectRelationIds();
  const byId = new Map<number, OsmRelation>();
  await fetchRelBatches(ids, 'members-part', byId);

  // スーパーリレーション: メンバーに未取得の relation が残っている限り追加取得（保険で3パスまで）
  for (let pass = 1; pass <= 3; pass++) {
    const nested = [
      ...new Set(
        [...byId.values()]
          .flatMap((rel) => rel.members ?? [])
          .filter((m) => m.type === 'relation' && !byId.has(m.ref))
          .map((m) => m.ref),
      ),
    ].sort((a, b) => a - b);
    if (nested.length === 0) break;
    console.log(`スーパーリレーション展開 pass ${pass}: ${nested.length} 件`);
    await fetchRelBatches(nested, `members-nested-${pass}`, byId);
  }

  await writeFile(outPath, JSON.stringify({ elements: [...byId.values()] }), 'utf8');
  console.log(`メンバー: 計 ${byId.size} リレーション → ${outPath}`);
}

/** メンバー way の線形を ID バッチで取得（["highway"] でフェリー区間を除外） */
async function fetchGeoms(): Promise<void> {
  const outPath = 'data-cache/routes/geoms.json';
  if (existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`線形: キャッシュ済み（${cached.elements.length} way、スキップ）`);
    return;
  }
  const members = JSON.parse(await readFile('data-cache/routes/members.json', 'utf8'));
  const wayIds = [
    ...new Set(
      (members.elements as OsmRelation[])
        .flatMap((rel) => rel.members ?? [])
        .filter((m) => m.type === 'way')
        .map((m) => m.ref),
    ),
  ].sort((a, b) => a - b);
  console.log(`線形: 対象 ${wayIds.length} way`);
  const byWayId = new Map<number, unknown>();
  for (let i = 0; i < wayIds.length; i += WAYS_BATCH_SIZE) {
    const batch = wayIds.slice(i, i + WAYS_BATCH_SIZE);
    const part = `data-cache/routes/geoms-part-${String(i / WAYS_BATCH_SIZE).padStart(3, '0')}.json`;
    await fetchOverpass(
      `線形 ${i / WAYS_BATCH_SIZE + 1}/${Math.ceil(wayIds.length / WAYS_BATCH_SIZE)}`,
      queryWaysBatch(batch),
      part,
    );
    const json = JSON.parse(await readFile(part, 'utf8'));
    for (const el of json.elements as { id: number }[]) byWayId.set(el.id, el);
    await sleep(BATCH_DELAY_MS);
  }
  await writeFile(outPath, JSON.stringify({ elements: [...byWayId.values()] }), 'utf8');
  console.log(`線形: 計 ${byWayId.size} way → ${outPath}`);
}

async function main() {
  await mkdir('data-cache/routes', { recursive: true });
  await fetchOverpass('国道リレーション一覧', QUERY_RELATIONS, 'data-cache/routes/relations.json');
  await fetchMembers();
  await fetchGeoms();
  console.log('完了');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
