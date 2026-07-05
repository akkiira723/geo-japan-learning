import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const URL = 'https://good-luck-day.com/area-code/';

export interface RawAreaCode {
  code: string;
  pref: string;
  /** ・区切りの市区町村・郡トークン */
  tokens: string[];
}

async function main() {
  await mkdir('data-cache/raw', { recursive: true });

  let html: string;
  if (existsSync('data-cache/raw/gld-top.html')) {
    console.log('キャッシュ済み HTML を使用');
    html = await readFile('data-cache/raw/gld-top.html', 'utf8');
  } else {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    html = await res.text();
    await writeFile('data-cache/raw/gld-top.html', html, 'utf8');
  }

  const clean = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
  const rows: RawAreaCode[] = [];
  for (const m of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => clean(c[1]));
    if (cells.length < 3) continue;
    const [code, pref, munis] = cells;
    if (!/^0\d{1,4}$/.test(code)) continue;
    const tokens = munis.split(/[・]/).map((t) => t.trim()).filter(Boolean);
    rows.push({ code, pref, tokens });
  }

  if (rows.length < 300) {
    throw new Error(`表の行数が想定より少ない: ${rows.length}（ページ構造が変わった可能性）`);
  }

  const codes = new Set(rows.map((r) => r.code));
  const prefs = new Set(rows.map((r) => r.pref));
  console.log(`市外局番 ${codes.size} 種 / ${rows.length} 行 / ${prefs.size} 都道府県`);
  await writeFile('data-cache/raw/areacodes.json', JSON.stringify(rows, null, 1), 'utf8');
  console.log('→ data-cache/raw/areacodes.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
