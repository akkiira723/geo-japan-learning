import { readFile } from 'node:fs/promises';
import type { Feature, MultiPolygon, Polygon } from 'geojson';
import { toMulti, type MultiCoords } from './muni-geo.ts';
import { normalizeName } from './normalize.ts';

/**
 * 「クイズの出題単位としての現行自治体」= 市（政令市は全区を合算して1つ）・特別区・町村。
 * N03（国土数値情報 行政区域）から組み立て、5桁の市区町村コード（政令市は末尾 00）で一意に識別する。
 * マンホールの手動選定（scripts/overrides/manhole-selections.json のキー）と build-manholes の名寄せで共用する。
 */
export interface MuniUnit {
  /** JIS 5桁コード。政令市は "01100" のように末尾 00 */
  code: string;
  /** 表示名（「札幌市」「愛別町」「千代田区」） */
  name: string;
  /** 町村のみ: 郡名（「上川郡」）。市・特別区は空 */
  gun: string;
  /** ポリゴン（テストでは省略可） */
  coords?: MultiCoords;
}

export interface MuniUnitIndex {
  /** コード昇順 */
  units: MuniUnit[];
  byCode: Map<string, MuniUnit>;
  /** 正規化した市名・特別区名（政令市含む） → 単位 */
  byCity: Map<string, MuniUnit>;
  /** 正規化「郡名+町村名」 → 単位 */
  byGunTown: Map<string, MuniUnit>;
  /** 正規化町村名 → 単位（同名の町村が別の郡にあると複数） */
  byTown: Map<string, MuniUnit[]>;
}

export function buildUnitIndex(units: MuniUnit[]): MuniUnitIndex {
  const sorted = [...units].sort((a, b) => a.code.localeCompare(b.code));
  const idx: MuniUnitIndex = { units: sorted, byCode: new Map(), byCity: new Map(), byGunTown: new Map(), byTown: new Map() };
  for (const u of sorted) {
    idx.byCode.set(u.code, u);
    const n = normalizeName(u.name);
    if (u.gun) {
      idx.byGunTown.set(normalizeName(u.gun) + n, u);
      const list = idx.byTown.get(n);
      if (list) list.push(u);
      else idx.byTown.set(n, [u]);
    } else {
      idx.byCity.set(n, u);
    }
  }
  return idx;
}

/**
 * 自治体表示名から単位を引く。市・特別区 → 郡+町村（gun があるとき）→ 町村名（同名が1つのときだけ）の順。
 * gun には「○○郡」以外（振興局・「市」見出し等）が来ても無視する
 */
export function lookupUnit(idx: MuniUnitIndex, name: string, gun = ''): MuniUnit | undefined {
  const t = normalizeName(name);
  const gunT = normalizeName(gun);
  const city = idx.byCity.get(t);
  if (city) return city;
  if (gunT.endsWith('郡')) {
    const gt = idx.byGunTown.get(gunT + t);
    if (gt) return gt;
  }
  const towns = idx.byTown.get(t);
  return towns && towns.length === 1 ? towns[0] : undefined;
}

interface N03Props {
  N03_003: string | null;
  N03_004: string | null;
  N03_007: string | null;
}

/**
 * 政令市のコード = 区コードの最小値を 10 の位で切り下げ。
 * 横浜 14101〜14118 → 14100、川崎 14131〜 → 14130、大阪 27102〜（27101 は欠番）→ 27100
 */
export function seireiCodeOf(wardCodes: string[]): string {
  const min = Math.min(...wardCodes.map(Number));
  return String(Math.floor(min / 10) * 10).padStart(5, '0');
}

const unitCache = new Map<number, MuniUnitIndex>();

/** 県の N03（data-cache/geo/muni/）から出題単位の索引を作る（プロセス内キャッシュ） */
export async function loadMuniUnits(pref: number): Promise<MuniUnitIndex> {
  const cached = unitCache.get(pref);
  if (cached) return cached;
  const pp = String(pref).padStart(2, '0');
  const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
  const byKey = new Map<string, MuniUnit>();
  const wardCodes = new Map<string, string[]>();
  for (const f of gj.features as Feature<Polygon | MultiPolygon, N03Props>[]) {
    const g3raw = f.properties.N03_003;
    const g4raw = f.properties.N03_004;
    const code5 = f.properties.N03_007;
    // 所属未定地など名前かコードが無い領域は出題単位にしない
    if (!g4raw || !code5) continue;
    // 支庁・振興局は郡・政令市ではない
    const g3 = g3raw && !/支庁$|振興局$/.test(g3raw) ? g3raw : null;
    let key: string, unit: MuniUnit;
    if (g3 && g3.endsWith('郡')) {
      key = `${g3}|${g4raw}`;
      unit = { code: code5, name: g4raw, gun: g3, coords: [] };
    } else if (g3) {
      // 政令指定都市: N03_003=市名, N03_004=区名 → 市で1単位。市のコードは全区のコードから後で決める
      key = g3;
      unit = { code: '', name: g3, gun: '', coords: [] };
      const list = wardCodes.get(key) ?? [];
      list.push(code5);
      wardCodes.set(key, list);
    } else {
      key = g4raw;
      unit = { code: code5, name: g4raw, gun: '', coords: [] };
    }
    const cur = byKey.get(key) ?? unit;
    cur.coords = cur.coords!.concat(toMulti(f.geometry));
    byKey.set(key, cur);
  }
  for (const [key, codes] of wardCodes) byKey.get(key)!.code = seireiCodeOf(codes);
  const idx = buildUnitIndex([...byKey.values()]);
  unitCache.set(pref, idx);
  return idx;
}
