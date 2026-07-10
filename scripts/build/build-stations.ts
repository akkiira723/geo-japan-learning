import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseCsvRecords } from '../lib/csv.ts';
import { normalizeName } from '../lib/normalize.ts';

interface LineInfo {
  code: number;
  name: string;
  company_code?: number;
}

/** station_database (Seo-4d696b75) out/main/station.json の読み辞書に使う部分 */
interface KanaStation {
  original_name: string;
  name_kana: string;
  prefecture: number;
  lat: number;
  lng: number;
}

type Operator = 'jr' | 'subway' | 'other';

interface OutStation {
  id: string;
  n: string;
  /** ひらがな読み（station_database 由来 + overrides/station-yomi.json） */
  kana?: string;
  lat: number;
  lon: number;
  lines: string[];
  op: Operator;
}

/** ekidata の company_code 1〜6 は JR 各社 */
function classifyLine(name: string, companyCode: number | undefined): Operator {
  if ((companyCode !== undefined && companyCode >= 1 && companyCode <= 6) || /^JR|新幹線/.test(name)) {
    return 'jr';
  }
  if (/地下鉄|メトロ|都営/.test(name)) return 'subway';
  return 'other';
}

function classifyStation(ops: Operator[]): Operator {
  if (ops.includes('jr')) return 'jr';
  if (ops.includes('subway')) return 'subway';
  return 'other';
}

/** 突合キー: 全角英数（ＪＲ/２等）を NFKC で畳んでから共通の異体字正規化を通す */
const kanaMatchKey = (pref: number, name: string) => `${pref}|${normalizeName(name.normalize('NFKC'))}`;

/** 末尾の括弧注記（「押上〈スカイツリー前〉」「中町（西町北）」等）を落とした照合用の名前 */
const stripParen = (name: string) => name.replace(/[（(〈].*?[）)〉]\s*$/, '').trim();

/**
 * 読み辞書: 突合キー → 候補駅（同県同名は座標最近傍で確定）。
 * 読みは辞書由来のみで、機械かな変換はしない。
 */
function buildKanaIndex(list: KanaStation[]): Map<string, KanaStation[]> {
  const index = new Map<string, KanaStation[]>();
  const add = (key: string, s: KanaStation) => {
    const arr = index.get(key);
    if (arr) arr.push(s);
    else index.set(key, [s]);
  };
  for (const s of list) {
    if (!s.original_name || !s.name_kana) continue;
    add(kanaMatchKey(s.prefecture, s.original_name), s);
    // 辞書側は「四ツ谷(四ッ谷)」「押上（スカイツリー前）」のような併記があるため、
    // 括弧を落とした別名でも引けるようにする（読み側の括弧併記も同様に落とす）
    const stripped = stripParen(s.original_name);
    if (stripped !== s.original_name) {
      add(kanaMatchKey(s.prefecture, stripped), { ...s, name_kana: stripParen(s.name_kana) });
    }
  }
  return index;
}

function lookupKana(
  index: Map<string, KanaStation[]>,
  pref: number,
  name: string,
  lat: number,
  lon: number,
): string | undefined {
  const candidates =
    index.get(kanaMatchKey(pref, name)) ?? index.get(kanaMatchKey(pref, stripParen(name)));
  if (!candidates || candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0].name_kana;
  let best = candidates[0];
  let bestD = Infinity;
  for (const c of candidates) {
    const d = (c.lat - lat) ** 2 + (c.lng - lon) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best.name_kana;
}

async function main() {
  const csv = await readFile('data-cache/raw/stations.csv', 'utf8');
  const rows = parseCsvRecords(csv);
  const lineList: LineInfo[] = JSON.parse(await readFile('data-cache/raw/line.json', 'utf8'));
  const lineByCode = new Map(lineList.map((l) => [String(l.code), l]));
  const kanaIndex = buildKanaIndex(JSON.parse(await readFile('data-cache/raw/station-kana.json', 'utf8')));
  const yomiOverride: Record<string, string> = JSON.parse(
    await readFile('scripts/overrides/station-yomi.json', 'utf8'),
  );

  const active = rows.filter((r) => r.e_status === '0');
  console.log(`全 ${rows.length} 行 → 営業中 ${active.length} 駅レコード`);

  // station_g_cd でグループ化（同一駅の複数路線レコードを統合）
  const groups = new Map<string, typeof active>();
  for (const r of active) {
    const key = r.station_g_cd || r.station_cd;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  let unmatchedLines = new Set<string>();
  const unresolvedKana: string[] = [];
  const byPref = new Map<number, OutStation[]>();
  for (const [gcd, members] of groups) {
    // 代表レコード: station_cd == g_cd のものを優先
    const rep = members.find((m) => m.station_cd === gcd) ?? members[0];
    const pref = Number(rep.pref_cd);
    const lat = Number(rep.lat);
    const lon = Number(rep.lon);
    if (!pref || !Number.isFinite(lat) || !Number.isFinite(lon) || lat === 0) continue;

    const lineNames: string[] = [];
    const ops: Operator[] = [];
    for (const m of members) {
      const line = lineByCode.get(m.line_cd);
      if (line) {
        if (!lineNames.includes(line.name)) lineNames.push(line.name);
        ops.push(classifyLine(line.name, line.company_code));
      } else {
        unmatchedLines.add(m.line_cd);
        ops.push('other');
      }
    }

    // 読み: override（手動補正が最優先）→ station_database 辞書 → 未解決
    const kana =
      yomiOverride[`${pref}|${rep.station_name}`] ?? lookupKana(kanaIndex, pref, rep.station_name, lat, lon);
    if (!kana) unresolvedKana.push(`  "${pref}|${rep.station_name}": ""`);

    const st: OutStation = {
      id: gcd,
      n: rep.station_name,
      kana,
      lat,
      lon,
      lines: lineNames,
      op: classifyStation(ops),
    };
    const arr = byPref.get(pref);
    if (arr) arr.push(st);
    else byPref.set(pref, [st]);
  }

  if (unresolvedKana.length > 0) {
    console.error(`✗ 読み仮名が解決できない駅が ${unresolvedKana.length} 件あります。`);
    console.error('  scripts/overrides/station-yomi.json に以下のエントリを追記してください（値はひらがな読み）:');
    console.error(unresolvedKana.join('\n'));
    process.exit(1);
  }

  await mkdir('public/data/stations', { recursive: true });
  const prefCounts: Record<string, number> = {};
  let total = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const stations = (byPref.get(pref) ?? []).sort((a, b) => a.id.localeCompare(b.id));
    prefCounts[pref] = stations.length;
    total += stations.length;
    await writeFile(
      `public/data/stations/pref-${String(pref).padStart(2, '0')}.json`,
      JSON.stringify({ pref, stations }),
      'utf8',
    );
  }

  // 同名駅の統計（全国レベル）
  const nameCount = new Map<string, number>();
  for (const arr of byPref.values()) {
    for (const s of arr) nameCount.set(s.n, (nameCount.get(s.n) ?? 0) + 1);
  }
  const dupNames = [...nameCount.entries()].filter(([, c]) => c > 1);

  const opCount = { jr: 0, subway: 0, other: 0 };
  for (const arr of byPref.values()) for (const s of arr) opCount[s.op]++;

  await writeFile(
    'public/data/stations/index.json',
    JSON.stringify({
      version: 1,
      generatedAt: new Date().toISOString(),
      total,
      prefCounts,
      duplicateNameCount: dupNames.length,
      source: '駅データ.jp 形式公開シート + station_database (CC BY 4.0)',
    }),
    'utf8',
  );

  console.log(`グループ化後 ${total} 駅（47都道府県に分割）`);
  console.log(`事業者内訳: JR ${opCount.jr} / 地下鉄 ${opCount.subway} / その他 ${opCount.other}`);
  console.log(`同名駅グループ: ${dupNames.length} 件（例: ${dupNames.slice(0, 8).map(([n, c]) => `${n}×${c}`).join(', ')}）`);
  if (unmatchedLines.size > 0) {
    console.log(`⚠ line.json に見つからない line_cd: ${unmatchedLines.size} 件 → op='other' 扱い`);
  }
  console.log(`都道府県別: 東京 ${prefCounts[13]} / 北海道 ${prefCounts[1]} / 大阪 ${prefCounts[27]} / 沖縄 ${prefCounts[47]}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
