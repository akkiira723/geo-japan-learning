import { readFile, writeFile } from 'node:fs/promises';
import polygonClipping from 'polygon-clipping';
import type { MultiPolygon, Polygon } from 'geojson';
import { PREFECTURES } from '../../src/lib/prefectures.ts';

type Ring = [number, number][];
type PolyCoords = Ring[];
type MultiCoords = PolyCoords[];

function toMulti(geom: Polygon | MultiPolygon): MultiCoords {
  return geom.type === 'Polygon' ? [geom.coordinates as PolyCoords] : (geom.coordinates as MultiCoords);
}

/** 4桁（約11m）に丸め、連続重複点を除去。オーバーレイ表示専用の精度 */
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

/** 外環の signed area（deg²）。小島の除去に使う */
function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  return Math.abs(a / 2);
}

const MIN_ISLAND_AREA = 2e-4; // 約 2km² 未満の島は境界オーバーレイでは省略

async function main() {
  const features: object[] = [];
  let totalPolys = 0;
  for (let pref = 1; pref <= 47; pref++) {
    const pp = String(pref).padStart(2, '0');
    const gj = JSON.parse(await readFile(`data-cache/geo/muni/pref-${pp}.geojson`, 'utf8'));
    const multis: MultiCoords[] = gj.features.map(
      (f: { geometry: Polygon | MultiPolygon }) => toMulti(f.geometry),
    );
    let merged: MultiCoords;
    try {
      merged = polygonClipping.union(
        multis[0] as never,
        ...(multis.slice(1) as never[]),
      ) as MultiCoords;
    } catch {
      console.warn(`⚠ union 失敗: pref ${pp} → 連結にフォールバック`);
      merged = multis.flat();
    }
    merged = round4(merged).filter((poly) => poly.length > 0 && ringArea(poly[0]) >= MIN_ISLAND_AREA);
    totalPolys += merged.length;
    features.push({
      type: 'Feature',
      properties: { pref, name: PREFECTURES[pref] },
      geometry: { type: 'MultiPolygon', coordinates: merged },
    });
    process.stdout.write(`${pp} `);
  }
  console.log();
  const fc = { type: 'FeatureCollection', features };
  const json = JSON.stringify(fc);
  await writeFile('public/data/prefs-outline.json', json, 'utf8');
  console.log(`✓ prefs-outline.json ${(json.length / 1e6).toFixed(2)} MB / ${totalPolys} polygons`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
