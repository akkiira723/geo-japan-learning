import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

/**
 * e-Stat 統計LOD「標準地域コード」(SAC) から市区町村の読み仮名辞書を取得する。
 * 1970年以降の全市区町村（消滅自治体・政令市の区を含む）に ひらがな読み
 * （rdfs:label@ja-hrkt）が付いており、駅以外の全クイズの読み辞書として共有する。
 */
const ENDPOINT = 'https://data.e-stat.go.jp/lod/sparql/alldata/query';
const PAGE_SIZE = 2000;
const PAGE_DELAY_MS = 2000;
const USER_AGENT = 'geo-japan-learning-data/0.1 (contact: develop@langdemy.com)';

const PREFIXES = `
PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX dcterms: <http://purl.org/dc/terms/>`;

/**
 * 1エンティティ = C{5桁コード}-{告示日} で、同じコードでも改称・合併のたびに別 URI になる。
 * dcterms:valid が無いものは現行有効。ORDER BY ?s で行順を安定させてページングする。
 */
const pageQuery = (offset: number) => `${PREFIXES}
SELECT ?s ?code ?ja ?kana ?issued ?valid ?cls WHERE {
  ?s a sacs:StandardAreaCode ;
     dcterms:identifier ?code ;
     rdfs:label ?ja , ?kana .
  FILTER(lang(?ja)='ja') FILTER(lang(?kana)='ja-hrkt')
  OPTIONAL { ?s dcterms:issued ?issued }
  OPTIONAL { ?s dcterms:valid ?valid }
  OPTIONAL { ?s sacs:administrativeClass ?cls }
} ORDER BY ?s LIMIT ${PAGE_SIZE} OFFSET ${offset}`;

interface SparqlBinding {
  [k: string]: { type: string; value: string } | undefined;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(offset: number, cachePath: string): Promise<SparqlBinding[]> {
  if (existsSync(cachePath)) {
    const cached = JSON.parse(await readFile(cachePath, 'utf8'));
    console.log(`  offset ${offset}: キャッシュ済み（${cached.length} 行、スキップ）`);
    return cached;
  }
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(pageQuery(offset))}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/sparql-results+json' },
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
      const bindings = json.results?.bindings;
      // 形式が違う応答（HTMLエラー等は json パースで落ちる）や bindings 欠落はエラー扱い
      if (!Array.isArray(bindings)) throw new Error('bindings がありません');
      // 終端ページ（0行）はキャッシュに書かない — エラーが「取得済み」に見える事故防止
      if (bindings.length > 0) await writeFile(cachePath, JSON.stringify(bindings), 'utf8');
      console.log(`  offset ${offset}: ${bindings.length} 行`);
      return bindings;
    } catch (err) {
      console.warn(`  リトライ ${attempt}/5 (offset ${offset}): ${err instanceof Error ? err.message : err}`);
      if (attempt === 5) throw err;
      await sleep(5000 * attempt);
    }
  }
  throw new Error('unreachable');
}

export interface SacRawEntry {
  code: string;
  ja: string;
  kana: string;
  from: string | null;
  to: string | null;
  cls: string | null;
}

async function main() {
  await mkdir('data-cache/yomi', { recursive: true });
  const outPath = 'data-cache/yomi/sac.json';
  if (existsSync(outPath)) {
    const cached = JSON.parse(await readFile(outPath, 'utf8'));
    console.log(`SAC読み辞書: キャッシュ済み（${cached.entries.length} 件、スキップ）`);
    return;
  }

  console.log('e-Stat 統計LOD 標準地域コードを取得中...');
  // URI（= code + 告示日）でユニーク化。読みラベルが複数行になっても最後の値を採る
  const byUri = new Map<string, SacRawEntry>();
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const part = `data-cache/yomi/sac-part-${String(offset / PAGE_SIZE).padStart(2, '0')}.json`;
    const bindings = await fetchPage(offset, part);
    for (const b of bindings) {
      const uri = b.S?.value;
      if (!uri || !b.CODE || !b.JA || !b.KANA) continue;
      byUri.set(uri, {
        code: b.CODE.value,
        ja: b.JA.value,
        kana: b.KANA.value,
        from: b.ISSUED?.value ?? null,
        to: b.VALID?.value ?? null,
        cls: b.CLS ? b.CLS.value.split('#').pop()! : null,
      });
    }
    if (bindings.length < PAGE_SIZE) break;
    await sleep(PAGE_DELAY_MS);
  }

  if (byUri.size < 10000) {
    throw new Error(`取得件数が少なすぎます（${byUri.size} 件）。全1970年以降で約15,000件あるはず`);
  }
  const entries = [...byUri.values()].sort(
    (a, b) => a.code.localeCompare(b.code) || (a.from ?? '').localeCompare(b.from ?? ''),
  );
  await writeFile(outPath, JSON.stringify({ source: 'e-Stat 統計LOD 標準地域コード', entries }), 'utf8');
  console.log(`SAC読み辞書: ${entries.length} 件 → ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
