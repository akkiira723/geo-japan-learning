import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { columnIndex, readXlsx } from './xlsx.ts';

/** テスト用の最小 ZIP（deflate / stored 混在）を組み立てる */
function buildZip(files: { name: string; data: string; store?: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8');
    const comp = f.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(f.store ? 0 : 8, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(f.store ? 0 : 8, 10);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, eocd]);
}

const xlsx = buildZip([
  {
    name: 'xl/workbook.xml',
    data: '<workbook><sheets><sheet name="第１面事項_2020年" sheetId="1" r:id="rId1"/><sheet name="二枚目" sheetId="2" r:id="rId2"/></sheets></workbook>',
  },
  {
    name: 'xl/_rels/workbook.xml.rels',
    data: '<Relationships><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    store: true,
  },
  {
    name: 'xl/sharedStrings.xml',
    data:
      '<sst><si><t>地域</t><rPh sb="0" eb="2"><t>チイキ</t></rPh></si>' +
      '<si><r><t>01100_</t></r><r><t>札幌市</t></r></si><si><t>&amp;&lt;x&gt;</t></si></sst>',
  },
  {
    name: 'xl/worksheets/sheet1.xml',
    data:
      '<worksheet><sheetData>' +
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3"><v>1973395</v></c><c r="D3" t="inlineStr"><is><t>a</t></is></c><c r="E3"/></row>' +
      '</sheetData></worksheet>',
  },
  { name: 'xl/worksheets/sheet2.xml', data: '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>' },
]);

describe('readXlsx', () => {
  const wb = readXlsx(xlsx);
  it('シート名を workbook.xml の順で返す（rels の順序に依存しない）', () => {
    expect(wb.sheetNames).toEqual(['第１面事項_2020年', '二枚目']);
    expect(wb.rows(1)).toEqual([['7']]);
  });
  it('共有文字列・数値・inlineStr・空セルを列位置を保って読む', () => {
    const rows = wb.rows(0);
    expect(rows[0]).toEqual(['地域', '', '&<x>']);
    expect(rows[1]).toEqual([]); // r="2" は存在しない行
    expect(rows[2]).toEqual(['01100_札幌市', '1973395', '', 'a', '']);
  });
  it('ふりがな（rPh）は本文に含めない・リッチテキストの run は連結する', () => {
    expect(wb.rows(0)[0][0]).toBe('地域');
    expect(wb.rows(0)[2][0]).toBe('01100_札幌市');
  });
});

describe('columnIndex', () => {
  it('A=0, Z=25, AA=26, AB=27', () => {
    expect(columnIndex('A1')).toBe(0);
    expect(columnIndex('Z')).toBe(25);
    expect(columnIndex('AA10')).toBe(26);
    expect(columnIndex('AB')).toBe(27);
  });
});
