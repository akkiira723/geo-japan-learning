import { buildManholePref, createBuildContext, writeManholeIndex } from '../lib/manhole-build.ts';

/**
 * data-cache/manho/result（クロール）+ scripts/overrides/manhole-selections.json（手動選定）
 * → public/data/manholes/pref-XX.json + index.json
 */
async function main() {
  const ctx = await createBuildContext();
  const unresolved: string[] = [];
  const unresolvedYomi = new Set<string>();
  let total = 0, totalImgs = 0, legacyCount = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const r = await buildManholePref(pref, ctx);
    total += r.items;
    totalImgs += r.imgs;
    legacyCount += r.legacyCount;
    unresolved.push(...r.unresolved);
    r.unresolvedYomi.forEach((y) => unresolvedYomi.add(y));
  }

  if (unresolvedYomi.size > 0) {
    console.error(`✗ 読み仮名が解決できない自治体が ${unresolvedYomi.size} 件あります。`);
    console.error('  scripts/overrides/muni-yomi.json に以下のエントリを追記して再実行してください（値はひらがな読み）:');
    console.error([...unresolvedYomi].join('\n'));
    process.exit(1);
  }

  const selected = Object.keys(ctx.selections.munis).length;
  await writeManholeIndex(selected);
  console.log(`✓ ${total} 自治体 / ${totalImgs} 枚（うち旧市町村扱い ${legacyCount}、手動選定済み ${selected} 自治体）`);
  if (unresolved.length > 0) {
    console.log(`⚠ 名寄せ未解決 ${unresolved.length} 件（スキップ済み・overrides/manhole-fixes.json で解決可能）:`);
    unresolved.slice(0, 40).forEach((u) => console.log('  ' + u));
    if (unresolved.length > 40) console.log(`  ...ほか ${unresolved.length - 40} 件`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
