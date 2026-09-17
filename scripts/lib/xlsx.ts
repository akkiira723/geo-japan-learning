import { inflateRawSync } from 'node:zlib';

/**
 * 依存ライブラリ無しの最小 xlsx リーダー。
 * e-Stat の集計表（1シート数千行・数式無し・単純な文字列/数値セル）を読む用途に絞っている。
 * ZIP64・暗号化・数式の再計算・日付書式の解釈はサポートしない。
 */

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/** ZIP の central directory を走査してエントリ一覧を返す */
function readZipEntries(buf: Buffer): ZipEntry[] {
  // End of central directory record（末尾から検索。コメント無しなら末尾 22 バイト）
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP: end of central directory が見つかりません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('ZIP: central directory が壊れています');
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localHeaderOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buf: Buffer, entry: ZipEntry): Buffer {
  const p = entry.localHeaderOffset;
  if (buf.readUInt32LE(p) !== 0x04034b50) throw new Error(`ZIP: local header が壊れています (${entry.name})`);
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const data = buf.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) return inflateRawSync(data);
  throw new Error(`ZIP: 未対応の圧縮方式 ${entry.method} (${entry.name})`);
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * <si> / <is> 内のテキストを連結する。<rPh>（ふりがな）は本文ではないので除く
 * （e-Stat の表は見出しにふりがなが付いており、含めると「地域チイキ」のようになる）
 */
function textOf(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

/** "AB" → 27 のような列参照の 0 始まり index */
export function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export interface Workbook {
  sheetNames: string[];
  /** 指定シートを行配列（セルは文字列、空セルは ''）にする。行番号・列番号の欠けは詰めずに位置を保つ */
  rows(sheetIndex: number): string[][];
}

export function readXlsx(buf: Buffer): Workbook {
  const entries = new Map(readZipEntries(buf).map((e) => [e.name, e]));
  const file = (name: string): string => {
    const e = entries.get(name);
    if (!e) throw new Error(`xlsx: ${name} がありません`);
    return readZipFile(buf, e).toString('utf8');
  };

  const shared: string[] = [];
  if (entries.has('xl/sharedStrings.xml')) {
    for (const m of file('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }

  const rels = new Map<string, string>();
  for (const m of file('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = m[1].match(/\bId="([^"]*)"/)?.[1];
    const target = m[1].match(/\bTarget="([^"]*)"/)?.[1];
    if (id && target) rels.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  const sheets: { name: string; path: string }[] = [];
  for (const m of file('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = decodeXml(m[1].match(/\bname="([^"]*)"/)?.[1] ?? '');
    const rid = m[1].match(/\br:id="([^"]*)"/)?.[1] ?? '';
    const path = rels.get(rid);
    if (path) sheets.push({ name, path });
  }

  return {
    sheetNames: sheets.map((s) => s.name),
    rows(sheetIndex: number): string[][] {
      const sheet = sheets[sheetIndex];
      if (!sheet) throw new Error(`xlsx: シート ${sheetIndex} がありません`);
      const xml = file(sheet.path);
      const out: string[][] = [];
      for (const rm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
        const rowNum = Number(rm[1].match(/\br="(\d+)"/)?.[1] ?? out.length + 1);
        const cells: string[] = [];
        for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
          const attrs = cm[1];
          const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
          const col = ref ? columnIndex(ref) : cells.length;
          const type = attrs.match(/\bt="([^"]*)"/)?.[1];
          const inner = cm[2] ?? '';
          let value = '';
          if (type === 's') {
            const idx = Number(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? -1);
            value = shared[idx] ?? '';
          } else if (type === 'inlineStr') {
            value = textOf(inner);
          } else {
            value = decodeXml(inner.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
          }
          while (cells.length < col) cells.push('');
          cells[col] = value;
        }
        while (out.length < rowNum - 1) out.push([]);
        out.push(cells);
      }
      return out;
    },
  };
}
