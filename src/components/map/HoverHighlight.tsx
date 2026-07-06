import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { useEffect, useRef, useState } from 'react';
import { GeoJSON, useMapEvents } from 'react-leaflet';
import { loadChunk } from '../../hooks/useChunkLoader';
import { inBbox } from '../../lib/judge';
import type { HoverKind, LatLng } from '../../quizzes/types';

interface HoverFeature {
  id: string;
  bbox: [number, number, number, number];
  geom: Polygon | MultiPolygon;
}

type Ring = [number, number][];

function computeBbox(geom: Polygon | MultiPolygon): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const rings: Ring[] =
    geom.type === 'Polygon' ? (geom.coordinates as Ring[]) : (geom.coordinates as Ring[][]).flat();
  for (const ring of rings)
    for (const [x, y] of ring) {
      if (x < w) w = x;
      if (y < s) s = y;
      if (x > e) e = x;
      if (y > n) n = y;
    }
  return [w, s, e, n];
}

function mergeBbox(
  a: [number, number, number, number],
  b: [number, number, number, number],
): [number, number, number, number] {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

const pp = (p: number) => String(p).padStart(2, '0');

/** クイズの区割りに応じたホバー判定用ポリゴン集合を読み込む（チャンクはクイズローダーとキャッシュ共有） */
async function loadHoverFeatures(kind: HoverKind, prefs: number[]): Promise<HoverFeature[]> {
  if (kind === 'areacode') {
    const chunks = await Promise.all(
      prefs.map((p) =>
        loadChunk<{ areas: { code: string; bbox: [number, number, number, number]; geom: MultiPolygon }[] }>(
          `areacodes/pref-${pp(p)}.json`,
        ),
      ),
    );
    // 県またぎ局番は1つのハイライトにまとめる
    const byCode = new Map<string, { bbox: [number, number, number, number]; coords: MultiPolygon['coordinates'] }>();
    for (const c of chunks)
      for (const a of c.areas) {
        const cur = byCode.get(a.code);
        if (cur) {
          cur.coords = cur.coords.concat(a.geom.coordinates);
          cur.bbox = mergeBbox(cur.bbox, a.bbox);
        } else {
          byCode.set(a.code, { bbox: [...a.bbox] as [number, number, number, number], coords: a.geom.coordinates });
        }
      }
    return [...byCode.entries()].map(([code, e]) => ({
      id: code,
      bbox: e.bbox,
      geom: { type: 'MultiPolygon', coordinates: e.coords },
    }));
  }
  if (kind === 'legacy') {
    const chunks = await Promise.all(
      prefs.map((p) =>
        loadChunk<{ towns: { id: string; bbox: [number, number, number, number]; geom: Polygon | MultiPolygon }[] }>(
          `legacy/pref-${pp(p)}.json`,
        ),
      ),
    );
    return chunks.flatMap((c) => c.towns.map((t) => ({ id: t.id, bbox: t.bbox, geom: t.geom })));
  }
  // muni: 現市区町村（muni-outline は全市区町村を含む）
  const chunks = await Promise.all(
    prefs.map((p) => loadChunk<FeatureCollection<Polygon | MultiPolygon>>(`muni-outline/pref-${pp(p)}.json`)),
  );
  return chunks.flatMap((c, ci) =>
    c.features.map((f, fi) => ({
      id: `${prefs[ci]}-${fi}`,
      bbox: computeBbox(f.geometry),
      geom: f.geometry,
    })),
  );
}

export interface HoverHighlightProps {
  kind: HoverKind;
  prefs: number[];
  /** 出題中のみ有効（回答表示中は正解表示を邪魔しない） */
  active: boolean;
}

export function HoverHighlight({ kind, prefs, active }: HoverHighlightProps) {
  const [features, setFeatures] = useState<HoverFeature[] | null>(null);
  const [hover, setHover] = useState<HoverFeature | null>(null);
  const lastMoveRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setFeatures(null);
    setHover(null);
    loadHoverFeatures(kind, prefs)
      .then((f) => {
        if (!cancelled) setFeatures(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [kind, prefs]);

  useEffect(() => {
    if (!active) setHover(null);
  }, [active]);

  useMapEvents({
    mousemove(e) {
      if (!active || !features) return;
      const now = Date.now();
      if (now - lastMoveRef.current < 50) return;
      lastMoveRef.current = now;
      const p: LatLng = { lat: e.latlng.lat, lng: e.latlng.lng };
      let found: HoverFeature | null = null;
      for (const f of features) {
        if (!inBbox(p, f.bbox)) continue;
        if (booleanPointInPolygon([p.lng, p.lat], f.geom)) {
          found = f;
          break;
        }
      }
      setHover((prev) => (prev?.id === found?.id ? prev : found));
    },
    mouseout() {
      setHover(null);
    },
  });

  if (!active || !hover) return null;
  return (
    <GeoJSON
      key={hover.id}
      data={hover.geom}
      interactive={false}
      style={{ color: '#1d4ed8', weight: 2.5, opacity: 0.9, fillColor: '#60a5fa', fillOpacity: 0.3 }}
    />
  );
}
