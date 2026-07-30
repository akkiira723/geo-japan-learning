import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { MultiPolygon, Polygon } from 'geojson';

type Ring = [number, number][];
type PolyCoords = Ring[];
type MultiCoords = PolyCoords[];

function toMulti(geom: Polygon | MultiPolygon): MultiCoords {
  return geom.type === 'Polygon' ? [geom.coordinates as PolyCoords] : (geom.coordinates as MultiCoords);
}

function round4(coords: MultiCoords): MultiCoords {
  return coords.map((poly) =>
    poly.map((ring) => {
      const out: Ring = [];
      for (const [x, y] of ring) {
        const p: [number, number] = [Math.round(x * 1e4) / 1e4, Math.round(y * 1e4) / 1e4];
        const prev = out[out.length - 1];
        if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
      }
      return out;
    }),
  );
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

const MIN_ISLAND_AREA = 5e-5; // 約 0.5km² 未満の島は省略

interface N03Props {
  N03_003?: string | null;
  N03_004?: string | null;
}

/**
 * 現市区町村名。政令市は「市+区」を連結（例: さいたま市岩槻区）、
 * それ以外は N03_004 のみ（郡名・支庁名は含めない）。legacy の into と同じ表記になる。
 */
function muniName(p: N03Props): string {
  const g = p.N03_003 ?? '';
  const n = p.N03_004 ?? '';
  return g.endsWith('市') ? g + n : n;
}

async function main() {
  await mkdir('public/data/muni-outline', { recursive: true });
  const prefBbox: Record<number, [number, number, number, number]> = {} as never;
  let totalBytes = 0;

  for (let pref = 1; pref <= 47; pref++) {
    const pp = String(pref).padStart(2, '0');
    const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    const features = gj.features.map((f: { properties: N03Props; geometry: Polygon | MultiPolygon }) => {
      const coords = round4(toMulti(f.geometry)).filter(
        (poly) => poly.length > 0 && ringArea(poly[0]) >= MIN_ISLAND_AREA,
      );
      for (const poly of coords)
        for (const ring of poly)
          for (const [x, y] of ring) {
            if (x < w) w = x;
            if (y < s) s = y;
            if (x > e) e = x;
            if (y > n) n = y;
          }
      // n: 名前ハイライト用（旧市町村 名前クイズの正解発表マップが into と突き合わせる）
      return {
        type: 'Feature',
        properties: { n: muniName(f.properties) },
        geometry: { type: 'MultiPolygon', coordinates: coords },
      };
    }).filter((f: { geometry: MultiPolygon }) => f.geometry.coordinates.length > 0);

    const r = (v: number) => Math.round(v * 1e4) / 1e4;
    prefBbox[pref] = [r(w), r(s), r(e), r(n)];
    const json = JSON.stringify({ type: 'FeatureCollection', features });
    totalBytes += json.length;
    await writeFile(`public/data/muni-outline/pref-${pp}.json`, json, 'utf8');
  }

  await writeFile(
    'public/data/muni-outline/index.json',
    JSON.stringify({ version: 2, prefBbox, source: '国土数値情報 N03 (japan-topography s0010)' }),
    'utf8',
  );
  console.log(`✓ muni-outline 47チャンク 計 ${(totalBytes / 1e6).toFixed(1)} MB`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
