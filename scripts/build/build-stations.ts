import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseCsvRecords } from '../lib/csv.ts';

interface LineInfo {
  code: number;
  name: string;
  company_code?: number;
}

type Operator = 'jr' | 'subway' | 'other';

interface OutStation {
  id: string;
  n: string;
  k?: string;
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

async function main() {
  const csv = await readFile('data-cache/raw/stations.csv', 'utf8');
  const rows = parseCsvRecords(csv);
  const lineList: LineInfo[] = JSON.parse(await readFile('data-cache/raw/line.json', 'utf8'));
  const lineByCode = new Map(lineList.map((l) => [String(l.code), l]));

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

    const st: OutStation = {
      id: gcd,
      n: rep.station_name,
      k: rep.station_name_k || undefined,
      lat,
      lon,
      lines: lineNames,
      op: classifyStation(ops),
    };
    const arr = byPref.get(pref);
    if (arr) arr.push(st);
    else byPref.set(pref, [st]);
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
