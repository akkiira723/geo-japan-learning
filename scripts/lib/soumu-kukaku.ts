/**
 * 総務省「市外局番の一覧」の番号区画テキストの構文解析。
 *
 * 文法（観測済みの全パターン）:
 * - 都道府県名で始まり、「、」区切りで市区町村・郡トークンが並ぶ。県境をまたぐ区画は
 *   途中で別の都道府県名が現れる。
 * - トークンは「名前」+ 任意の「（…を除く。）」「（…に限る。）」修飾。
 *   「（…を含む。）」は携帯発信時の扱いに関する注記であり地理には無関係なので捨てる。
 * - 修飾の中身は「、」「及び」「並びに」区切りの名前リスト。リスト項目自体が
 *   さらに「（…に限る。）」等で修飾されることがある（例: 西蒲区（打越…に限る。））。
 * - 丁目は漢数字。「一丁目及び三丁目から五丁目まで」のような範囲・省略形がある
 *   （省略形は直前項目の親字（stem）を引き継ぐ）。
 */

import { normalizeName } from './normalize.ts';

export interface RawAreaCodeRow {
  ma: string;
  code: string;
  kukaku: string;
}

export interface TokenMod {
  type: 'except' | 'only';
  items: SubToken[];
}

export interface SubToken {
  name: string;
  mod: TokenMod | null;
}

export interface KukakuToken {
  pref: string;
  name: string;
  mod: TokenMod | null;
}

export const PREF_NAMES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県', '茨城県', '栃木県',
  '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県', '新潟県', '富山県', '石川県', '福井県',
  '山梨県', '長野県', '岐阜県', '静岡県', '愛知県', '三重県', '滋賀県', '京都府', '大阪府',
  '兵庫県', '奈良県', '和歌山県', '鳥取県', '島根県', '岡山県', '広島県', '山口県', '徳島県',
  '香川県', '愛媛県', '高知県', '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県',
  '鹿児島県', '沖縄県',
];

/** 深さ0の区切り文字で分割（（）の入れ子を考慮） */
function splitTop(s: string, seps: string[]): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let i = 0;
  outer: while (i < s.length) {
    if (s[i] === '（') depth++;
    if (s[i] === '）') depth--;
    if (depth === 0) {
      for (const sep of seps) {
        if (s.startsWith(sep, i)) {
          out.push(cur);
          cur = '';
          i += sep.length;
          continue outer;
        }
      }
    }
    cur += s[i];
    i++;
  }
  if (cur) out.push(cur);
  return out;
}

const KANJI_DIGITS = '〇一二三四五六七八九';

function kanjiToInt(s: string): number | null {
  // 一〜九十九まで（丁目番号に十分）
  const m = s.match(/^(?:([一二三四五六七八九])?十)?([一二三四五六七八九])?$/);
  if (!m || (!m[1] && !m[2] && !s.includes('十'))) return null;
  if (s === '') return null;
  const tens = s.includes('十') ? (m[1] ? KANJI_DIGITS.indexOf(m[1]) : 1) : 0;
  const ones = m[2] ? KANJI_DIGITS.indexOf(m[2]) : 0;
  const v = tens * 10 + ones;
  return v > 0 ? v : null;
}

export function intToKanji(n: number): string {
  if (n <= 0 || n >= 100) throw new Error(`丁目番号が範囲外: ${n}`);
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return (
    (tens >= 2 ? KANJI_DIGITS[tens] : '') + (tens >= 1 ? '十' : '') + (ones ? KANJI_DIGITS[ones] : '')
  );
}

const CHOME_RANGE = /^(.*?)([一二三四五六七八九十]+)丁目から([一二三四五六七八九十]+)丁目まで$/;
const CHOME_SINGLE = /^(.*?)([一二三四五六七八九十]+)丁目$/;

/**
 * 「、」「及び」「並びに」区切りの名前リストを項目配列へ。
 * 丁目の範囲（AからBまで）と親字省略（「石神一丁目及び三丁目」の「三丁目」）を展開する。
 */
function parseNameList(s: string): SubToken[] {
  const out: SubToken[] = [];
  let stem = '';
  for (const rawItem of splitTop(s, ['、', '並びに', '及び'])) {
    const item = rawItem.trim();
    if (!item) continue;
    const { name, mod } = parseNameAndMod(item);

    const range = name.match(CHOME_RANGE);
    if (range) {
      const from = kanjiToInt(range[2]);
      const to = kanjiToInt(range[3]);
      if (from === null || to === null || from > to) throw new Error(`丁目範囲が読めない: ${item}`);
      if (range[1]) stem = range[1];
      for (let n = from; n <= to; n++) out.push({ name: stem + intToKanji(n) + '丁目', mod });
      continue;
    }
    const single = name.match(CHOME_SINGLE);
    if (single) {
      if (single[1]) stem = single[1];
      out.push({ name: stem + single[2] + '丁目', mod });
      continue;
    }
    stem = '';
    out.push({ name, mod });
  }
  return out;
}

/** 「名前（…を除く。）」等を分解。「（…を含む。）」注記は捨てる */
function parseNameAndMod(token: string): { name: string; mod: TokenMod | null } {
  const i = token.indexOf('（');
  if (i < 0) return { name: token, mod: null };
  if (i === 0) throw new Error(`名前がない: ${token}`);
  const name = token.slice(0, i);

  // 「名前（グループ1）（グループ2）…」のグループを括弧の対応で分離
  const groups: string[] = [];
  let depth = 0;
  let start = -1;
  for (let j = i; j < token.length; j++) {
    const ch = token[j];
    if (ch === '（') {
      if (depth === 0) start = j + 1;
      depth++;
    } else if (ch === '）') {
      depth--;
      if (depth === 0) groups.push(token.slice(start, j));
      if (depth < 0) throw new Error(`括弧の対応が崩れている: ${token}`);
    } else if (depth === 0) {
      throw new Error(`括弧の外に文字がある: ${token}`);
    }
  }
  if (depth !== 0) throw new Error(`括弧が閉じていない: ${token}`);

  let mod: TokenMod | null = null;
  for (const g of groups) {
    if (g.endsWith('を含む。')) continue; // 携帯発信の注記
    const type = g.endsWith('を除く。') ? ('except' as const) : g.endsWith('に限る。') ? ('only' as const) : null;
    if (!type) throw new Error(`修飾の末尾が読めない: ${token}`);
    if (mod) throw new Error(`修飾が複数ある: ${token}`);
    mod = { type, items: parseNameList(g.slice(0, -4)) };
  }
  return { name, mod };
}

/** 1行の番号区画テキストをトークン列へ */
export function parseKukaku(kukaku: string): KukakuToken[] {
  const out: KukakuToken[] = [];
  let pref = '';
  for (const raw of splitTop(kukaku, ['、'])) {
    let t = raw.trim();
    if (!t) continue;
    for (const p of PREF_NAMES) {
      if (t.startsWith(p)) {
        pref = p;
        t = t.slice(p.length);
        break;
      }
    }
    if (!pref) throw new Error(`都道府県名で始まっていない: ${kukaku.slice(0, 40)}`);
    if (!t) continue;
    const { name, mod } = parseNameAndMod(t);
    out.push({ pref, name, mod });
  }
  return out;
}

// ---------------------------------------------------------------------------
// 市町村への名寄せとコード別スペックへの集約

/** パーサ利用側が注入する市町村名の知識（N03 由来） */
export interface MuniKnowledge {
  /** 県内の全市町村のフル名（「樺戸郡月形町」「夕張市」「京都市」など。政令市は市名のみ） */
  muniNames(pref: string): string[];
  /** 郡名 → 所属町村のフル名リスト（郡でなければ null） */
  gunTowns(pref: string, gun: string): string[] | null;
}

/** ある市町村のある市外局番に対する主張（同一局番の複数 MA 行をマージ済み） */
export interface MuniCodeSpec {
  /** 無条件で市町村全体を主張する行があった */
  whole: boolean;
  /** 「（…を除く。）」の項目（市町村内の大字等） */
  excepts: SubToken[];
  /** 「（…に限る。）」の項目と「市名+大字」形式の項目 */
  onlys: SubToken[];
}

export type MuniClaims = Map<string, Map<string, Map<string, MuniCodeSpec>>>; // pref → muni → code → spec

/**
 * 全行のトークンを (県, 市町村, 局番) 単位に集約する。
 * 郡トークンは町村単位の主張に展開する。
 */
export function collectMuniClaims(
  rows: { code: string; tokens: KukakuToken[] }[],
  know: MuniKnowledge,
  unresolved: string[],
  resolveOverride: (pref: string, name: string) => string[] | null | undefined,
): MuniClaims {
  const claims: MuniClaims = new Map();

  const spec = (pref: string, muni: string, code: string): MuniCodeSpec => {
    let m = claims.get(pref);
    if (!m) claims.set(pref, (m = new Map()));
    let c = m.get(muni);
    if (!c) m.set(muni, (c = new Map()));
    let s = c.get(code);
    if (!s) c.set(code, (s = { whole: false, excepts: [], onlys: [] }));
    return s;
  };

  const addToken = (code: string, tok: KukakuToken) => {
    const { pref, mod } = tok;
    let name = tok.name;
    const ov = resolveOverride(pref, name);
    if (ov === null) return; // 明示的に無視
    if (ov !== undefined) {
      for (const n of ov) addToken(code, { pref, name: n, mod });
      return;
    }

    // 郡: 町村単位の主張に展開
    const towns = know.gunTowns(pref, name);
    if (towns) {
      if (!mod) {
        for (const t of towns) spec(pref, t, code).whole = true;
        return;
      }
      const named: string[] = [];
      for (const item of mod.items) {
        const nItem = normalizeName(item.name);
        // 「A町」だけでなく「A町田立」のような町村+大字の項目もある → 前方一致で町村を探す
        let full: string | undefined;
        let sub = '';
        let bestLen = 0;
        for (const t of towns) {
          const townOnly = normalizeName(t).replace(/^.*郡/, '');
          if (nItem.startsWith(townOnly) && townOnly.length > bestLen) {
            full = t;
            sub = item.name.slice(townOnly.length);
            bestLen = townOnly.length;
          }
        }
        if (!full) {
          unresolved.push(`${code} ${pref}|${name}（…${item.name}…）: 郡内に町村が見つからない`);
          continue;
        }
        named.push(full);
        if (mod.type === 'only') {
          if (sub || item.mod) {
            // 「郡（A町X…に限る。）」— 町村の一部だけを含む
            addToken(code, { pref, name: full + sub, mod: item.mod });
          } else {
            spec(pref, full, code).whole = true;
          }
        } else {
          // except 側
          if (sub) {
            // 「郡（A町Xを除く。）」= A町は X 以外を含む
            addToken(code, { pref, name: full, mod: { type: 'except', items: [{ name: sub, mod: item.mod }] } });
          } else if (item.mod) {
            // 「郡（A町（Xに限る。）を除く。）」= A町は X 以外を含む → 修飾を反転
            addToken(code, {
              pref,
              name: full,
              mod: { type: item.mod.type === 'only' ? 'except' : 'only', items: item.mod.items },
            });
          }
          // sub も item.mod もない場合は A町 全体が除外（何も主張しない）
        }
      }
      if (mod.type === 'except') {
        for (const t of towns) if (!named.includes(t)) spec(pref, t, code).whole = true;
      }
      return;
    }

    // 市町村: 最長一致でフル名を探し、残りは大字等のサブ名
    // （normalizeName は 1文字→1文字置換のみなので slice 位置は生文字列と一致する）
    const munis = know.muniNames(pref);
    const nName = normalizeName(name);
    let matched = '';
    for (const m of munis) {
      if (nName.startsWith(normalizeName(m)) && m.length > matched.length) matched = m;
    }
    if (!matched) {
      unresolved.push(`${code} ${pref}|${name}`);
      return;
    }
    const sub = name.slice(matched.length);
    const s = spec(pref, matched, code);
    if (sub) {
      s.onlys.push({ name: sub, mod });
    } else if (!mod) {
      s.whole = true;
    } else if (mod.type === 'except') {
      s.excepts.push(...mod.items);
    } else {
      s.onlys.push(...mod.items);
    }
  };

  for (const row of rows) {
    for (const tok of row.tokens) addToken(row.code, tok);
  }
  return claims;
}

// ---------------------------------------------------------------------------
// 分割市町村のスコープ計画（政令市は区単位、それ以外は市町村単位で小地域を切り分ける）

export interface ScopeSpec {
  /** code → 小地域名の包含/除外リスト */
  perCode: Map<string, { incl: SubToken[]; excl: SubToken[] }>;
}

export interface SplitPlan {
  /** 市町村レベルで「残り全部」を主張する局番（whole または except 行の主） */
  defaultCode: string | null;
  /** 区名（政令市）または '' （それ以外）→ スコープ内の包含/除外 */
  scopes: Map<string, ScopeSpec>;
  /** 区全体を主張する局番（小地域不要、N03 の区ポリゴンで足りる） */
  wardWholes: Map<string, string>;
  errors: string[];
}

/**
 * 複数局番に分割される市町村について、小地域の切り分け計画を立てる。
 * wards: 政令市なら区名リスト、それ以外は null。
 */
export function planSplitMuni(muni: string, codeSpecs: Map<string, MuniCodeSpec>, wards: string[] | null): SplitPlan {
  const plan: SplitPlan = { defaultCode: null, scopes: new Map(), wardWholes: new Map(), errors: [] };

  const scopeOf = (ward: string): ScopeSpec => {
    let s = plan.scopes.get(ward);
    if (!s) plan.scopes.set(ward, (s = { perCode: new Map() }));
    return s;
  };
  const entry = (ward: string, code: string) => {
    const s = scopeOf(ward);
    let e = s.perCode.get(code);
    if (!e) s.perCode.set(code, (e = { incl: [], excl: [] }));
    return e;
  };

  const route = (code: string, item: SubToken, side: 'incl' | 'excl') => {
    if (!wards) {
      entry('', code)[side].push(item);
      return;
    }
    const nName = normalizeName(item.name);
    let ward = '';
    for (const w of wards) {
      if (nName.startsWith(normalizeName(w)) && w.length > ward.length) ward = w;
    }
    if (!ward) {
      plan.errors.push(`${muni}: 区名で始まらない項目「${item.name}」`);
      return;
    }
    const rest = item.name.slice(ward.length);
    if (!rest && !item.mod) {
      // 区全体
      if (side === 'incl') plan.wardWholes.set(ward, code);
      else scopeOf(ward); // 除外側: 他局番がこの区を主張するはず。スコープだけ確保
      return;
    }
    if (!rest && item.mod) {
      // 「花見川区（柏井…に限る。）」: 区内の限定リスト（incl/excl どちらの側でも対象はそのリスト）
      if (item.mod.type === 'only') {
        for (const sub of item.mod.items) entry(ward, code)[side].push(sub);
        return;
      }
      // 「秋葉区（覚路津を除く。）」を含む側 = その区の残り全部を主張（区スコープのデフォルト）
      if (side === 'incl') {
        plan.wardWholes.set(ward, code);
        entry(ward, code).excl.push(...item.mod.items);
        return;
      }
      plan.errors.push(`${muni}: 除外リスト内の区項目にさらに except（未対応）「${item.name}」`);
      return;
    }
    entry(ward, code)[side].push({ name: rest, mod: item.mod });
  };

  for (const [code, spec] of codeSpecs) {
    if (spec.whole || spec.excepts.length > 0) {
      if (plan.defaultCode && plan.defaultCode !== code) {
        plan.errors.push(`${muni}: 「残り全部」を主張する局番が複数（${plan.defaultCode} と ${code}）`);
      }
      plan.defaultCode = code;
    }
    for (const item of spec.excepts) route(code, item, 'excl');
    for (const item of spec.onlys) route(code, item, 'incl');
  }
  return plan;
}
