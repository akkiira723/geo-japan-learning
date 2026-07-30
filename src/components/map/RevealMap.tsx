import L from 'leaflet';
import { useEffect } from 'react';
import { GeoJSON, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import type { Target } from '../../quizzes/types';
import { RubyText } from '../quiz/RubyText';

const TILE_URL = 'https://tile.openstreetmap.jp/styles/maptiler-basic-ja/{z}/{x}/{y}{r}.png';
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' +
  ' / tiles by <a href="https://tile.openstreetmap.jp/" target="_blank" rel="noreferrer">OSMFJ</a>';

/** 全ターゲットが収まるようにズームを合わせる */
function FitToTargets({ targets }: { targets: Target[] }) {
  const map = useMap();
  useEffect(() => {
    if (targets.length === 0) return;
    let bounds = L.latLngBounds(targets.map((t) => [t.point[0], t.point[1]] as [number, number]));
    for (const t of targets) {
      if (t.bbox) {
        bounds = bounds.extend(L.latLngBounds([t.bbox[1], t.bbox[0]], [t.bbox[3], t.bbox[2]]));
      }
    }
    map.fitBounds(bounds.pad(0.4), { maxZoom: 10 });
  }, [targets, map]);
  return null;
}

/**
 * 正解発表用の小型マップ。テキスト回答式クイズで、正解の旧市町村ポリゴンを
 * ハイライト表示する（正解済み=緑 / 未回答=橙。色は QuizMap の回答後表示と揃える）。
 */
export function RevealMap({ targets, solvedIds }: { targets: Target[]; solvedIds: ReadonlySet<string> }) {
  return (
    <MapContainer
      center={[37.5, 137.0]}
      zoom={5}
      minZoom={4}
      maxZoom={18}
      className="reveal-map"
      attributionControl={true}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxNativeZoom={18} keepBuffer={6} />
      <FitToTargets targets={targets} />
      {targets.map((t) => {
        if (!t.geom) return null;
        const solved = solvedIds.has(t.id);
        return (
          <GeoJSON
            key={t.id}
            data={t.geom}
            style={{ color: solved ? '#1fa588' : '#e8a13d', weight: 2, fillOpacity: 0.25 }}
          >
            <Tooltip direction="top" permanent>
              <div className="tt-label">
                {solved ? '✅ ' : '⭐ '}
                <RubyText text={t.label} rubies={t.rubies} />
              </div>
            </Tooltip>
          </GeoJSON>
        );
      })}
    </MapContainer>
  );
}
