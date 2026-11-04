import { exec } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ALL_PREF_CODES, PREFECTURES } from '../../src/lib/prefectures.ts';
import {
  buildManholePref,
  createBuildContext,
  loadLegacyTowns,
  writeManholeIndex,
  type BuildContext,
  type MuniResult,
} from '../lib/manhole-build.ts';
import {
  describePairs,
  ensureManhoCacheDirs,
  fetchManhoImage,
  fetchManhoPage,
  MANHO_BASE,
  parseIndexLinks,
  parsePairs,
  prefIndexUrl,
  stripKanaHeading,
} from '../lib/manhole-parse.ts';
import {
  groupIndexLinks,
  legacyTownsForUnit,
  loadSelections,
  saveSelections,
  type MuniPage,
  type MuniSelection,
  type SelectedImg,
} from '../lib/manhole-selection.ts';
import { loadMuniUnits, lookupUnit } from '../lib/muni-units.ts';

/**
 * マンホール画像の手動選定ツール（ローカル専用）。
 *
 *   npm run select:manholes   → http://localhost:5188/
 *
 * 都道府県 → 市町村コード順に、日本マンホール蓋学会の該当ページ（デザイン１/２・その他・上水道等のサブページ込み）の
 * 画像と説明文を一覧表示する。採用した画像は scripts/overrides/manhole-selections.json に保存され、
 * その県の public/data/manholes/pref-XX.json がその場で再生成される（クイズ・単語帳にすぐ反映）。
 */

const PORT = Number(process.env.PORT ?? 5188);
const HTML_PATH = join(dirname(fileURLToPath(import.meta.url)), 'manhole-select.html');

interface MuniView {
  code: string;
  name: string;
  gun: string;
  pages: MuniPage[];
  legacy: { id: string; n: string; gun: string; kana?: string }[];
  /** クロール（ヒューリスティック）が現在採用している画像 URL（参考表示用） */
  auto: string[];
  selection: MuniSelection | null;
}

let ctx: BuildContext;
/** 保存 → 再生成 を直列化する */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const p = queue.then(fn, fn);
  queue = p.catch(() => undefined);
  return p;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function text(res: ServerResponse, status: number, body: string, type = 'text/plain; charset=utf-8'): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/** 取得対象は同サイトのみ（任意 URL のプロキシにしない） */
function siteUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.href.startsWith(MANHO_BASE) ? u.href : null;
  } catch {
    return null;
  }
}

async function listPrefs(): Promise<{ code: number; name: string; total: number; reviewed: number }[]> {
  const selections = await loadSelections();
  const out = [];
  for (const code of ALL_PREF_CODES) {
    const units = await loadMuniUnits(code);
    const reviewed = Object.values(selections.munis).filter((s) => s.pref === code).length;
    out.push({ code, name: PREFECTURES[code], total: units.units.length, reviewed });
  }
  return out;
}

async function prefView(pref: number): Promise<{ pref: number; name: string; munis: MuniView[]; unmatched: { text: string; url: string }[] }> {
  const prefName = PREFECTURES[pref];
  const units = await loadMuniUnits(pref);
  const indexUrl = prefIndexUrl(pref);
  const html = await fetchManhoPage(indexUrl);
  if (!html) throw new Error(`県インデックスを取得できません: ${indexUrl}`);
  const grouped = groupIndexLinks(parseIndexLinks(html, indexUrl), units, ctx.fixes, prefName);
  const legacyTowns = await loadLegacyTowns(pref);
  const selections = await loadSelections();

  // クロール結果（あれば）: 自治体コード → 採用中 URL
  const auto = new Map<string, string[]>();
  const resultPath = `data-cache/manho/result/pref-${String(pref).padStart(2, '0')}.json`;
  if (existsSync(resultPath)) {
    const results: MuniResult[] = JSON.parse(await readFile(resultPath, 'utf8'));
    for (const m of results) {
      let name = stripKanaHeading(m.name);
      const fix = ctx.fixes[`${prefName}|${name}`];
      if (fix === null) continue;
      if (fix) name = fix;
      const unit = lookupUnit(units, name, m.gun ?? '');
      if (!unit) continue;
      auto.set(unit.code, [...(auto.get(unit.code) ?? []), ...m.imgs.map((i) => i.url)]);
    }
  }

  const munis: MuniView[] = units.units.map((u) => ({
    code: u.code,
    name: u.name,
    gun: u.gun,
    pages: grouped.byCode.get(u.code) ?? [],
    legacy: legacyTownsForUnit(u, legacyTowns).map((t) => ({ id: t.id, n: t.n, gun: t.gun, kana: t.kana })),
    auto: auto.get(u.code) ?? [],
    selection: selections.munis[u.code] ?? null,
  }));
  return { pref, name: prefName, munis, unmatched: grouped.unmatched };
}

async function pageView(url: string) {
  const html = await fetchManhoPage(url);
  if (!html) throw new Error(`ページを取得できません: ${url}`);
  return { url, imgs: describePairs(parsePairs(html, url)) };
}

function validateSelection(body: unknown): { code: string; pref: number; name: string; imgs: SelectedImg[] } {
  const b = body as Record<string, unknown>;
  if (typeof b.code !== 'string' || !/^\d{5}$/.test(b.code)) throw new Error('code が不正');
  if (typeof b.pref !== 'number' || !(b.pref in PREFECTURES)) throw new Error('pref が不正');
  if (typeof b.name !== 'string') throw new Error('name が不正');
  if (!Array.isArray(b.imgs)) throw new Error('imgs が不正');
  const imgs: SelectedImg[] = b.imgs.map((raw) => {
    const i = raw as Record<string, unknown>;
    const url = siteUrl(typeof i.url === 'string' ? i.url : null);
    const page = siteUrl(typeof i.page === 'string' ? i.page : null);
    if (!url || !page) throw new Error('画像 URL が不正');
    const out: SelectedImg = { url, page, desc: typeof i.desc === 'string' ? i.desc : '' };
    if (typeof i.legacy === 'string' && i.legacy) out.legacy = i.legacy;
    return out;
  });
  return { code: b.code, pref: b.pref, name: b.name, imgs };
}

/** 選定ファイルを更新してその県を再生成する */
async function applySelection(pref: number, mutate: (file: Awaited<ReturnType<typeof loadSelections>>) => void) {
  return serialized(async () => {
    const file = await loadSelections();
    mutate(file);
    await saveSelections(file);
    ctx.selections = file;
    const build = await buildManholePref(pref, ctx);
    const index = await writeManholeIndex(Object.keys(file.munis).length);
    if (build.unresolvedYomi.length > 0) {
      console.warn(`⚠ 読み仮名未解決（muni-yomi.json に追記）:\n${build.unresolvedYomi.join('\n')}`);
    }
    return { build, index };
  });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === 'GET' && path === '/') {
    text(res, 200, await readFile(HTML_PATH, 'utf8'), 'text/html; charset=utf-8');
    return;
  }
  if (req.method === 'GET' && path === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (req.method === 'GET' && path === '/api/prefs') {
    json(res, 200, await listPrefs());
    return;
  }
  const prefM = path.match(/^\/api\/pref\/(\d{1,2})$/);
  if (req.method === 'GET' && prefM) {
    const pref = Number(prefM[1]);
    if (!(pref in PREFECTURES)) return json(res, 404, { error: '不明な都道府県' });
    json(res, 200, await prefView(pref));
    return;
  }
  if (req.method === 'GET' && path === '/api/page') {
    const target = siteUrl(url.searchParams.get('url'));
    if (!target) return json(res, 400, { error: 'url が不正' });
    json(res, 200, await pageView(target));
    return;
  }
  if (req.method === 'GET' && path === '/api/img') {
    const target = siteUrl(url.searchParams.get('url'));
    if (!target) return text(res, 400, 'url が不正');
    const buf = await fetchManhoImage(target);
    if (!buf) return text(res, 404, '画像を取得できません');
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=86400' });
    res.end(buf);
    return;
  }
  if (req.method === 'POST' && path === '/api/select') {
    const sel = validateSelection(JSON.parse(await readBody(req)));
    const r = await applySelection(sel.pref, (file) => {
      file.munis[sel.code] = { pref: sel.pref, name: sel.name, imgs: sel.imgs };
    });
    console.log(`保存: ${sel.code} ${sel.name} → ${sel.imgs.length} 枚（旧市町村 ${sel.imgs.filter((i) => i.legacy).length}）`);
    json(res, 200, { ok: true, ...r });
    return;
  }
  const delM = path.match(/^\/api\/select\/(\d{5})$/);
  if (req.method === 'DELETE' && delM) {
    const code = delM[1];
    const pref = Number(code.slice(0, 2));
    const r = await applySelection(pref, (file) => {
      delete file.munis[code];
    });
    console.log(`取り消し: ${code}`);
    json(res, 200, { ok: true, ...r });
    return;
  }
  json(res, 404, { error: 'not found' });
}

async function main() {
  await ensureManhoCacheDirs();
  ctx = await createBuildContext();
  const server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    });
  });
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`ポート ${PORT} は使用中です。前回のサーバーが残っていないか確認してください:`);
      console.error(`  netstat -ano | findstr :${PORT}   → 右端の PID を taskkill /PID <PID> /F`);
      console.error(`別ポートで起動するには: PORT=5189 npm run select:manholes`);
      process.exit(1);
    }
    throw err;
  });
  server.listen(PORT, '127.0.0.1', () => {
    const addr = `http://localhost:${PORT}/`;
    console.log(`マンホール画像選定ツール: ${addr}`);
    console.log('採用結果 → scripts/overrides/manhole-selections.json（県ごとに public/data/manholes/pref-XX.json を即時再生成）');
    if (process.platform === 'win32' && !process.argv.includes('--no-open')) {
      exec(`start "" "${addr}"`);
    }
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
