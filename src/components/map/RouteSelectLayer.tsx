import type { FeatureCollection, MultiLineString } from 'geojson';
import L from 'leaflet';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GeoJSON, useMap, useMapEvents } from 'react-leaflet';
import { loadChunk } from '../../hooks/useChunkLoader';
import { nearestLineId, pxToKm, type LineFeature } from '../../lib/lineHover';
import type { LatLng, RouteBand } from '../../quizzes/types';

/** カーソル/クリック位置から路線を拾うしきい値（ピクセル） */
const SNAP_PX = 12;

interface RouteChunk {
  band: RouteBand;
  items: { n: number; bbox: [number, number, number, number]; geom: MultiLineString }[];
}

const ALL_BANDS: RouteBand[] = ['two', 'three-low', 'three-high'];

/**
 * 国道番号クイズの選択式回答レイヤー。
 * 出題中は全路線を薄く表示し、カーソル下（SNAP_PX 以内）の路線をハイライト。
 * クリックで onSelect(路線id | null, 地点) を発火し、選択路線を濃く表示する。
 * 番号は表示しない（クリックで番号を読み取る総当たり防止）。
 */
export function RouteSelectLayer({
  active,
  selectedId,
  onSelect,
}: {
  active: boolean;
  selectedId: string | null;
  onSelect: (id: string | null, p: LatLng) => void;
}) {
  const [features, setFeatures] = useState<LineFeature[] | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const lastMoveRef = useRef(0);
  const map = useMap();
  // 全路線 7.6万点級の常時表示はこのレイヤーだけ Canvas で描く（高速道路オーバーレイと同じ手法）
  const renderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all(ALL_BANDS.map((b) => loadChunk<RouteChunk>(`routes/${b}.json`)))
      .then((chunks) => {
        if (cancelled) return;
        setFeatures(
          chunks.flatMap((c) => c.items.map((r) => ({ id: String(r.n), bbox: r.bbox, geom: r.geom }))),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!active) setHoverId(null);
  }, [active]);

  const byId = useMemo(() => {
    if (!features) return null;
    return new Map(features.map((f) => [f.id, f]));
  }, [features]);

  /** 全路線をまとめた薄い背景線（1 Feature = Leaflet 1 Polyline 群で描画レイヤ最小） */
  const allLines = useMemo<FeatureCollection | null>(() => {
    if (!features) return null;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'MultiLineString',
            coordinates: features.flatMap((f) => f.geom.coordinates),
          },
        },
      ],
    };
  }, [features]);

  const pick = (latlng: L.LatLng): string | null => {
    if (!features) return null;
    const p: LatLng = { lat: latlng.lat, lng: latlng.lng };
    return nearestLineId(features, p, pxToKm(SNAP_PX, map.getZoom(), p.lat));
  };

  useMapEvents({
    mousemove(e) {
      if (!active || !features) return;
      const now = Date.now();
      if (now - lastMoveRef.current < 50) return;
      lastMoveRef.current = now;
      const found = pick(e.latlng);
      setHoverId((prev) => (prev === found ? prev : found));
      map.getContainer().style.cursor = found ? 'pointer' : '';
    },
    mouseout() {
      setHoverId(null);
    },
    click(e) {
      if (!active) return;
      // データロード中でもピンは置けるようにする（クリックが無反応になる時間を作らない）
      onSelect(features ? pick(e.latlng) : null, { lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });

  // 回答表示中はカーソルを戻す
  useEffect(() => {
    if (!active) map.getContainer().style.cursor = '';
  }, [active, map]);

  if (!active) return null;
  const hover = hoverId && hoverId !== selectedId ? byId?.get(hoverId) : null;
  const selected = selectedId ? byId?.get(selectedId) : null;
  return (
    <>
      {allLines && (
        <GeoJSON
          data={allLines}
          interactive={false}
          style={{ color: '#64748b', weight: 1.2, opacity: 0.5, renderer }}
        />
      )}
      {hover && (
        <GeoJSON
          key={`hover-${hover.id}`}
          data={hover.geom}
          interactive={false}
          style={{ color: '#177f69', weight: 4, opacity: 0.9 }}
        />
      )}
      {selected && (
        <GeoJSON
          key={`selected-${selected.id}`}
          data={selected.geom}
          interactive={false}
          style={{ color: '#0ea5e9', weight: 4.5, opacity: 0.95 }}
        />
      )}
    </>
  );
}
