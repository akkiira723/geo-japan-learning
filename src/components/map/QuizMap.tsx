import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Circle, GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import { loadChunk } from '../../hooks/useChunkLoader';
import type { HitMark } from '../../hooks/useQuizEngine';
import type { LatLng, Question, Target } from '../../quizzes/types';

const GSI_ATTR =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const CARTO_ATTR = OSM_ATTR + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

type MapTypeId = 'gsi-pale' | 'gsi-std' | 'voyager' | 'osm';

const MAP_TYPES: Record<MapTypeId, { label: string; url: string; attr: string; subdomains?: string; maxNativeZoom: number }> = {
  'gsi-pale': {
    label: '地理院 淡色',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    attr: GSI_ATTR,
    maxNativeZoom: 18,
  },
  'gsi-std': {
    label: '地理院 標準',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    attr: GSI_ATTR,
    maxNativeZoom: 18,
  },
  voyager: {
    label: 'CARTO Voyager',
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: CARTO_ATTR,
    subdomains: 'abcd',
    maxNativeZoom: 19,
  },
  osm: {
    label: 'OSM 標準',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: OSM_ATTR,
    maxNativeZoom: 19,
  },
};

const MAPTYPE_KEY = 'geo-japan-learning:maptype';
const BORDER_KEY = 'geo-japan-learning:prefborder';

function loadMapType(): MapTypeId {
  const v = localStorage.getItem(MAPTYPE_KEY);
  return v && v in MAP_TYPES ? (v as MapTypeId) : 'gsi-pale';
}

function divPin(className: string, html: string): L.DivIcon {
  return L.divIcon({ className: '', html: `<div class="${className}">${html}</div>`, iconSize: [24, 24], iconAnchor: [12, 24] });
}

const guessPinIcon = divPin('pin pin-guess', '📍');
const hitPinIcon = divPin('pin pin-hit', '✅');
const answerPinIcon = divPin('pin pin-answer', '⭐');
const missIcon = L.divIcon({ className: '', html: '<div class="pin pin-miss">✕</div>', iconSize: [16, 16], iconAnchor: [8, 8] });

function ClickHandler({ onClick }: { onClick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

/** 回答後に正解全体が入るようズームを合わせる */
function RevealFit({ targets, active }: { targets: Target[]; active: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (!active || targets.length === 0) return;
    let bounds = L.latLngBounds(targets.map((t) => [t.point[0], t.point[1]] as [number, number]));
    for (const t of targets) {
      if (t.bbox) {
        bounds = bounds.extend(L.latLngBounds([t.bbox[1], t.bbox[0]], [t.bbox[3], t.bbox[2]]));
      }
    }
    map.fitBounds(bounds.pad(0.4), { maxZoom: 10 });
  }, [active, targets, map]);
  return null;
}

export interface QuizMapProps {
  question: Question | null;
  revealed: boolean;
  pin: LatLng | null;
  hitMarks: HitMark[];
  missMarks: LatLng[];
  radiusKm: number;
  onPlacePin: (p: LatLng) => void;
}

export function QuizMap({ question, revealed, pin, hitMarks, missMarks, radiusKm, onPlacePin }: QuizMapProps) {
  const hitIds = useMemo(() => new Set(hitMarks.map((h) => h.target.id)), [hitMarks]);
  const [mapType, setMapType] = useState<MapTypeId>(loadMapType);
  const [showBorder, setShowBorder] = useState(() => localStorage.getItem(BORDER_KEY) !== '0');
  const [outline, setOutline] = useState<FeatureCollection | null>(null);

  useEffect(() => {
    if (!showBorder || outline) return;
    let cancelled = false;
    loadChunk<FeatureCollection>('prefs-outline.json')
      .then((fc) => {
        if (!cancelled) setOutline(fc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showBorder, outline]);

  const changeMapType = (t: MapTypeId) => {
    setMapType(t);
    localStorage.setItem(MAPTYPE_KEY, t);
  };
  const toggleBorder = (on: boolean) => {
    setShowBorder(on);
    localStorage.setItem(BORDER_KEY, on ? '1' : '0');
  };

  const tile = MAP_TYPES[mapType];

  return (
    <>
      <MapContainer
        center={[37.5, 137.0]}
        zoom={5}
        minZoom={4}
        maxZoom={16}
        className="quiz-map"
        attributionControl={true}
      >
        <TileLayer
          key={mapType}
          url={tile.url}
          attribution={tile.attr}
          maxNativeZoom={tile.maxNativeZoom}
          {...(tile.subdomains ? { subdomains: tile.subdomains } : {})}
        />

        {/* 県境強調オーバーレイ（クリックは地図へ素通し） */}
        {showBorder && outline && (
          <GeoJSON
            data={outline}
            interactive={false}
            style={{ color: '#e11d48', weight: 1.3, opacity: 0.65, fillOpacity: 0 }}
          />
        )}

        {!revealed && <ClickHandler onClick={onPlacePin} />}
        {question && <RevealFit targets={question.targets} active={revealed} />}

        {pin && <Marker position={[pin.lat, pin.lng]} icon={guessPinIcon} />}

        {missMarks.map((m, i) => (
          <Marker key={`miss-${i}`} position={[m.lat, m.lng]} icon={missIcon} interactive={false} />
        ))}

        {/* 回答済みターゲット（出題中も正解済みピンは残す） */}
        {question &&
          question.targets
            .filter((t) => hitIds.has(t.id))
            .map((t) => (
              <Marker key={t.id} position={[t.point[0], t.point[1]]} icon={hitPinIcon}>
                <Tooltip direction="top" offset={[0, -20]} permanent={revealed}>
                  {t.label}
                </Tooltip>
              </Marker>
            ))}

        {/* 回答後: 未正解ターゲットと判定範囲・ポリゴンを表示 */}
        {revealed &&
          question &&
          question.targets.map((t) => {
            const wasHit = hitIds.has(t.id);
            return (
              <span key={`reveal-${t.id}`}>
                {!wasHit && (
                  <Marker position={[t.point[0], t.point[1]]} icon={answerPinIcon}>
                    <Tooltip direction="top" offset={[0, -20]} permanent>
                      {t.label}
                    </Tooltip>
                  </Marker>
                )}
                {t.kind === 'point' && (
                  <Circle
                    center={[t.point[0], t.point[1]]}
                    radius={radiusKm * 1000}
                    pathOptions={{ color: wasHit ? '#16a34a' : '#f59e0b', weight: 1.5, fillOpacity: 0.08 }}
                  />
                )}
                {t.kind === 'polygon' && t.geom && (
                  <GeoJSON
                    data={t.geom}
                    style={{ color: wasHit ? '#16a34a' : '#f59e0b', weight: 2, fillOpacity: 0.18 }}
                  />
                )}
              </span>
            );
          })}
      </MapContainer>

      <div className="map-control">
        <select
          value={mapType}
          onChange={(e) => changeMapType(e.target.value as MapTypeId)}
          aria-label="地図の種類"
        >
          {(Object.entries(MAP_TYPES) as [MapTypeId, (typeof MAP_TYPES)[MapTypeId]][]).map(([id, t]) => (
            <option key={id} value={id}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="map-control-check">
          <input type="checkbox" checked={showBorder} onChange={(e) => toggleBorder(e.target.checked)} />
          県境を強調
        </label>
      </div>
    </>
  );
}
