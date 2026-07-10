import { readFile } from 'node:fs/promises';
import { normalizeName } from './normalize.ts';

/**
 * e-Stat 標準地域コード（SAC）読み辞書の引き当て。
 * fetch-sac-yomi.ts が生成する data-cache/yomi/sac.json を各 build が共有する。
 * 読みは辞書由来のみ（機械かな変換はしない）。辞書に無いものは各 build が
 * overrides/*-yomi.json → それでも無ければ未解決として報告する。
 */
export interface SacEntry {
  /** JIS 5桁コード（都道府県は "01000" 形式） */
  code: string;
  ja: string;
  /** ひらがな読み */
  kana: string;
  /** 告示日（この日からこの表記が有効） */
  from: string | null;
  /** 失効日（null = 現行有効） */
  to: string | null;
  /** City / Town / Village / Ward / SpecialWard / Prefecture / District 等 */
  cls: string | null;
}

export interface SacDict {
  /** code5 → 告示日昇順のエントリ列 */
  byCode: Map<string, SacEntry[]>;
  /** `県番号|normalizeName(名称)` → エントリ列（新しい期間が先頭） */
  byPrefName: Map<string, SacEntry[]>;
}

export function buildSacDict(entries: SacEntry[]): SacDict {
  const byCode = new Map<string, SacEntry[]>();
  const byPrefName = new Map<string, SacEntry[]>();
  for (const e of entries) {
    const codeList = byCode.get(e.code);
    if (codeList) codeList.push(e);
    else byCode.set(e.code, [e]);

    const pref = Number(e.code.slice(0, 2));
    const nameKey = `${pref}|${normalizeName(e.ja)}`;
    const nameList = byPrefName.get(nameKey);
    if (nameList) nameList.push(e);
    else byPrefName.set(nameKey, [e]);
  }
  for (const list of byCode.values()) {
    list.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
  }
  for (const list of byPrefName.values()) {
    list.sort((a, b) => (b.from ?? '').localeCompare(a.from ?? ''));
  }
  return { byCode, byPrefName };
}

export async function loadSacDict(path = 'data-cache/yomi/sac.json'): Promise<SacDict> {
  const raw = JSON.parse(await readFile(path, 'utf8')) as { entries: SacEntry[] };
  return buildSacDict(raw.entries);
}

/** スナップショット日時点で有効だったコードのエントリ（旧市町村のコード直引き用） */
export function sacAt(dict: SacDict, code5: string, dateISO: string): SacEntry | undefined {
  const list = dict.byCode.get(code5);
  if (!list) return undefined;
  return list.find(
    (e) => (e.from === null || e.from <= dateISO) && (e.to === null || dateISO < e.to),
  );
}

/** 現行有効（to=null）の (県, 名前) 引き。市外局番の munis 等の現行市区町村用 */
export function sacCurrentByName(dict: SacDict, pref: number, name: string): SacEntry | undefined {
  const list = dict.byPrefName.get(`${pref}|${normalizeName(name)}`);
  return list?.find((e) => e.to === null);
}

/**
 * 全期間の (県, 名前) 引き（新しい順）。消滅自治体を含むマンホール自治体名用。
 * 同名で読みが異なる別自治体が同県にあった場合は複数返る — 呼び出し側で
 * 曖昧（読みが2種以上）なら未解決として override に回すこと。
 */
export function sacByName(dict: SacDict, pref: number, name: string): SacEntry[] {
  return dict.byPrefName.get(`${pref}|${normalizeName(name)}`) ?? [];
}

/** sacByName の結果から一意な読みを取り出す。読みが割れていれば null（=要 override） */
export function uniqueKana(entries: SacEntry[]): string | null {
  const kanas = new Set(entries.map((e) => e.kana));
  if (kanas.size !== 1) return null;
  return entries[0].kana;
}

/** 表示文字列のうち読み（ひらがな）が対応する部分。ルビは base の部分にだけ振る */
export interface Yomi {
  b: string;
  k: string;
}

/**
 * 市区町村の表示名から読みを解決する。表示名には「空知郡南幌町」「岩見沢市（一部）」の
 * ような装飾が付くため、(1)（一部）を落とす → (2) そのまま引く → (3) 郡プレフィックスを
 * 落として引く、の順で試す（(2) を先にするのは「蒲郡市」等の郡を含む市名のため）。
 * includeHistory=true なら消滅自治体も対象（読みが割れたら null = 要 override）。
 */
export function resolveMuniYomi(
  dict: SacDict,
  pref: number,
  displayName: string,
  includeHistory = false,
): Yomi | null {
  const lookup = (name: string): string | null => {
    if (includeHistory) return uniqueKana(sacByName(dict, pref, name));
    return sacCurrentByName(dict, pref, name)?.kana ?? null;
  };
  const core = displayName.replace(/[（(]一部[）)]\s*$/, '').trim();
  const direct = lookup(core);
  if (direct) return { b: core, k: direct };
  const m = core.match(/^.{1,6}?郡(.+)$/);
  if (m) {
    const rest = lookup(m[1]);
    if (rest) return { b: m[1], k: rest };
  }
  return null;
}
