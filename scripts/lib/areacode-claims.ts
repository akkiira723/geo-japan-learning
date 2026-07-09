import { readFile } from 'node:fs/promises';
import {
  parseKukaku,
  collectMuniClaims,
  planSplitMuni,
  type KukakuToken,
  type MuniClaims,
  type MuniCodeSpec,
  type RawAreaCodeRow,
  type SplitPlan,
} from './soumu-kukaku.ts';
import { loadPref, makeMuniKnowledge, prefCodeByName } from './n03.ts';
import { normalizeName } from './normalize.ts';

export interface ParsedRow {
  ma: string;
  code: string;
  tokens: KukakuToken[];
}

export interface LoadedClaims {
  rows: ParsedRow[];
  claims: MuniClaims;
}

/**
 * data-cache/raw/areacodes.json（総務省 PDF のパース結果）を読み、
 * overrides を適用して (県, 市町村, 局番) 単位の主張に集約する。
 * 名寄せ未解決が残る場合は一覧を表示して throw する。
 */
export async function loadClaims(): Promise<LoadedClaims> {
  const raw: RawAreaCodeRow[] = JSON.parse(await readFile('data-cache/raw/areacodes.json', 'utf8'));
  const overrides: Record<string, string[] | null> = JSON.parse(
    await readFile('scripts/overrides/areacode-muni-fixes.json', 'utf8'),
  );
  const usedOverrides = new Set<string>();

  const rows: ParsedRow[] = raw.map((r) => ({ ma: r.ma, code: r.code, tokens: parseKukaku(r.kukaku) }));
  const know = await makeMuniKnowledge();
  const unresolved: string[] = [];
  const claims = collectMuniClaims(rows, know, unresolved, (pref, name) => {
    const key = `${pref}|${name}`;
    if (key in overrides) {
      usedOverrides.add(key);
      return overrides[key];
    }
    return undefined;
  });

  const unusedOverrides = Object.keys(overrides).filter((k) => !usedOverrides.has(k));
  if (unusedOverrides.length > 0) {
    console.warn(`⚠ 使われていない override: ${unusedOverrides.join(', ')}`);
  }
  if (unresolved.length > 0) {
    console.error(`\n✗ 名寄せ未解決 ${unresolved.length} 件:`);
    unresolved.forEach((u) => console.error('  ' + u));
    console.error('\nscripts/overrides/areacode-muni-fixes.json に追記してください。');
    throw new Error('名寄せ未解決');
  }
  return { rows, claims };
}

export interface SplitMuni {
  pref: string;
  prefCd: number;
  muni: string;
  codeSpecs: Map<string, MuniCodeSpec>;
  wards: string[] | null;
  plan: SplitPlan;
  /** スコープ（区名 or ''）→ 5桁市区町村コード。小地域データが必要なもののみ */
  chochoNeeds: Map<string, string>;
}

/**
 * 複数の市外局番に分割される市町村を列挙し、小地域切り分けの計画と
 * 必要な小地域データ（5桁市区町村コード）を求める。
 */
export async function computeSplitMunis(claims: MuniClaims): Promise<SplitMuni[]> {
  const out: SplitMuni[] = [];
  const errors: string[] = [];
  for (const [pref, byMuni] of claims) {
    const prefCd = prefCodeByName.get(pref);
    if (!prefCd) throw new Error(`都道府県不明: ${pref}`);
    const idx = await loadPref(prefCd);
    for (const [muni, codeSpecs] of byMuni) {
      if (codeSpecs.size < 2) continue;
      const wards = idx.wards.get(normalizeName(muni)) ?? null;
      const plan = planSplitMuni(muni, codeSpecs, wards);
      errors.push(...plan.errors.map((e) => `${pref}${e}`));

      const chochoNeeds = new Map<string, string>();
      for (const [scope, spec] of plan.scopes) {
        const hasItems = [...spec.perCode.values()].some((e) => e.incl.length > 0 || e.excl.length > 0);
        if (!hasItems) continue;
        const key = wards ? normalizeName(muni) + normalizeName(scope) : normalizeName(muni);
        const code5 = idx.cityCode.get(key);
        if (!code5) {
          errors.push(`${pref}${muni}: 市区町村コードが見つからない（${key}）`);
          continue;
        }
        chochoNeeds.set(scope, code5);
      }
      out.push({ pref, prefCd, muni, codeSpecs, wards, plan, chochoNeeds });
    }
  }
  if (errors.length > 0) {
    console.error(`\n✗ 分割計画のエラー ${errors.length} 件:`);
    errors.forEach((e) => console.error('  ' + e));
    throw new Error('分割計画のエラー');
  }
  return out;
}
