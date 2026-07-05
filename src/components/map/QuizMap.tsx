import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { Circle, GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import type { HitMark } from '../../hooks/useQuizEngine';
import type { LatLng, Question, Target } from '../../quizzes/types';

// GeoGuessr の回答マップに近い Google Maps 風スタイル（CARTO Voyager）
const TILE_URL = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

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

  return (
    <MapContainer
      center={[37.5, 137.0]}
      zoom={5}
      minZoom={4}
      maxZoom={16}
      className="quiz-map"
      attributionControl={true}
    >
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} subdomains="abcd" maxNativeZoom={19} />

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
  );
}
