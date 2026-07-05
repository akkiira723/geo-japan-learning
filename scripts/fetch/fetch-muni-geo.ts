import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE =
  'https://raw.githubusercontent.com/smartnews-smri/japan-topography/main/data/municipality/geojson/s0010';

async function main() {
  await mkdir('data-cache/geo/muni', { recursive: true });
  for (let pref = 1; pref <= 47; pref++) {
    const pp = String(pref).padStart(2, '0');
    const dest = `data-cache/geo/muni/pref-${pp}.geojson`;
    if (existsSync(dest)) continue;
    const url = `${BASE}/N03-21_${pp}_210101.json`;
    process.stdout.write(`pref ${pp} ... `);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`fetch failed ${res.status}: ${url}`);
    const text = await res.text();
    await writeFile(dest, text, 'utf8');
    console.log(`${(text.length / 1024).toFixed(0)} KB`);
    await new Promise((r) => setTimeout(r, 300));
  }
  console.log('完了');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
