import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

const { getDocument } = pdfjs;

// 総務省「市外局番の一覧」PDF。番号区画（MA）ごとの区画・市外局番の一次資料。
// 市外局番列は先頭の 0 が省略されているので付け直す。
const URL = 'https://www.soumu.go.jp/main_content/000141817.pdf';

// 表の縦罫線 x 座標（全ページ共通）: 82.0 | 120.2 | 422.7 | 466.1 | 512.7
// 列: [番号区画コード | 番号区画 | 市外局番 | 市内局番]
const COL_BOUNDS = [82, 120.2, 422.7, 466.1, 512.7];

export interface RawAreaCode {
  /** 番号区画コード（例: "4-2"） */
  ma: string;
  /** 市外局番（先頭 0 を復元済み） */
  code: string;
  /** 番号区画の原文（都道府県名から始まる。改行は除去済み） */
  kukaku: string;
}

function colOf(x: number): number {
  for (let c = 0; c < 4; c++) {
    if (x >= COL_BOUNDS[c] - 2 && x < COL_BOUNDS[c + 1] - 2) return c;
  }
  return -1;
}

async function parsePdf(data: Uint8Array): Promise<RawAreaCode[]> {
  const doc = await getDocument({
    data,
    cMapUrl: 'node_modules/pdfjs-dist/cmaps/',
    cMapPacked: true,
  }).promise;

  const rows: RawAreaCode[] = [];
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();

    // y（下原点）→ 行。同じ行の項目を x 順に列へ振り分ける
    const lines = new Map<number, { x: number; col: number; str: string }[]>();
    for (const item of content.items) {
      if (!('str' in item) || !item.str.trim()) continue;
      const x = item.transform[4] as number;
      const y = Math.round(item.transform[5] as number);
      const col = colOf(x);
      if (col < 0) continue; // 表外（タイトル等）
      let line = lines.get(y);
      // 微小な y ずれ（±1）を同一行に吸収
      if (!line) {
        for (const dy of [-1, 1]) {
          const near = lines.get(y + dy);
          if (near) {
            line = near;
            break;
          }
        }
      }
      if (!line) lines.set(y, (line = []));
      line.push({ x, col, str: item.str });
    }

    const sorted = [...lines.entries()]
      .sort((a, b) => b[0] - a[0]) // PDF 座標は下原点なので降順 = 上から
      .map(([, items]) => items.sort((a, b) => a.x - b.x));

    let cur: RawAreaCode | null = null;
    for (const line of sorted) {
      const cell = (c: number) =>
        line
          .filter((i) => i.col === c)
          .map((i) => i.str)
          .join('')
          .replace(/\s+/g, '');
      const ma = cell(0);
      if (/^\d+(-\d+)?$/.test(ma)) {
        const code = cell(2);
        if (!/^\d{1,4}$/.test(code)) {
          throw new Error(`p${pageNo}: 行頭 ${ma} の市外局番が読めない: "${code}"`);
        }
        cur = { ma, code: '0' + code, kukaku: cell(1) };
        rows.push(cur);
      } else if (cur && !ma) {
        cur.kukaku += cell(1); // 折り返し行
      } else {
        cur = null; // ヘッダ行など
      }
    }
  }
  return rows;
}

async function main() {
  await mkdir('data-cache/raw', { recursive: true });

  const pdfPath = 'data-cache/raw/soumu-areacodes.pdf';
  let buf: Buffer;
  if (existsSync(pdfPath)) {
    console.log('キャッシュ済み PDF を使用');
    buf = await readFile(pdfPath);
  } else {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`fetch failed ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(pdfPath, buf);
  }

  const rows = await parsePdf(new Uint8Array(buf));
  if (rows.length < 500) {
    throw new Error(`表の行数が想定より少ない: ${rows.length}（PDF 構成が変わった可能性）`);
  }
  const codes = new Set(rows.map((r) => r.code));
  console.log(`番号区画 ${rows.length} 行 / 市外局番 ${codes.size} 種`);
  await writeFile('data-cache/raw/areacodes.json', JSON.stringify(rows, null, 1), 'utf8');
  console.log('→ data-cache/raw/areacodes.json');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
