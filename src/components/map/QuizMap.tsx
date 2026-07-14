import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Circle, GeoJSON, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { RubyText } from '../quiz/RubyText';
import type { FeatureCollection } from 'geojson';
import { loadChunk } from '../../hooks/useChunkLoader';
import type { HitMark } from '../../hooks/useQuizEngine';
import type { HoverKind, LatLng, Question, QuizId, Target } from '../../quizzes/types';
import { HoverHighlight } from './HoverHighlight';

const GSI_ATTR =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">地理院タイル</a>';
const OSM_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors';
const CARTO_ATTR = OSM_ATTR + ' &copy; <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>';

type MapTypeId = 'bright-ja' | 'basic-ja' | 'gsi-pale' | 'gsi-std' | 'voyager' | 'osm';

const OSMFJ_ATTR =
  OSM_ATTR + ' / tiles by <a href="https://tile.openstreetmap.jp/" target="_blank" rel="noreferrer">OSMFJ</a>';

const MAP_TYPES: Record<MapTypeId, { label: string; url: string; attr: string; subdomains?: string; maxNativeZoom: number }> = {
  'bright-ja': {
    label: 'OSM Bright 日本語',
    url: 'https://tile.openstreetmap.jp/styles/osm-bright-ja/{z}/{x}/{y}{r}.png',
    attr: OSMFJ_ATTR,
    maxNativeZoom: 18,
  },
  'basic-ja': {
    label: 'ベーシック 日本語',
    url: 'https://tile.openstreetmap.jp/styles/maptiler-basic-ja/{z}/{x}/{y}{r}.png',
    attr: OSMFJ_ATTR,
    maxNativeZoom: 18,
  },
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

/** 鉄道強調オーバーレイ（OpenRailwayMap 透過タイル） */
const RAIL_URL = 'https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png';
const RAIL_ATTR =
  'Rail overlay &copy; <a href="https://www.openrailwaymap.org/" target="_blank" rel="noreferrer">OpenRailwayMap</a> (CC-BY-SA)';

/** クイズごとに地図設定を保存する（駅クイズは鉄道重視、他は境界重視のため共有しない） */
const MAP_SETTINGS_KEY_PREFIX = 'geo-japan-learning:mapsettings:';
/** 市町村境オーバーレイを表示する最小ズーム */
const MUNI_BORDER_MIN_ZOOM = 9;

interface MapSettings {
  mapType: MapTypeId;
  border: boolean;
  muniBorder: boolean;
  rail: boolean;
  highway: boolean;
}

function defaultMapSettings(quizId: QuizId): MapSettings {
  if (quizId === 'station') {
    return { mapType: 'basic-ja', border: false, muniBorder: false, rail: true, highway: false };
  }
  if (quizId === 'highway') {
    // 高速道路クイズは路線網の学習が主目的なので線形ハイライトのみ on
    return { mapType: 'basic-ja', border: false, muniBorder: false, rail: false, highway: true };
  }
  return { mapType: 'basic-ja', border: true, muniBorder: true, rail: false, highway: false };
}

function loadMapSettings(quizId: QuizId): MapSettings {
  const def = defaultMapSettings(quizId);
  try {
    const raw = localStorage.getItem(MAP_SETTINGS_KEY_PREFIX + quizId);
    if (!raw) return def;
    const v = JSON.parse(raw) as Partial<MapSettings>;
    return {
      mapType: v.mapType && v.mapType in MAP_TYPES ? v.mapType : def.mapType,
      border: typeof v.border === 'boolean' ? v.border : def.border,
      muniBorder: typeof v.muniBorder === 'boolean' ? v.muniBorder : def.muniBorder,
      rail: typeof v.rail === 'boolean' ? v.rail : def.rail,
      highway: typeof v.highway === 'boolean' ? v.highway : def.highway,
    };
  } catch {
    return def;
  }
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

interface MuniOutlineIndex {
  prefBbox: Record<string, [number, number, number, number]>;
}

const muniChunks = new Map<number, FeatureCollection>();

/** ズーム時のみ、表示範囲に重なる県の市町村境界線を遅延ロードして描画 */
function MuniBorders({ enabled }: { enabled: boolean }) {
  const [index, setIndex] = useState<MuniOutlineIndex | null>(null);
  const [visiblePrefs, setVisiblePrefs] = useState<number[]>([]);
  const [, bump] = useState(0);
  const map = useMap();

  useEffect(() => {
    if (!enabled || index) return;
    loadChunk<MuniOutlineIndex>('muni-outline/index.json').then(setIndex).catch(() => {});
  }, [enabled, index]);

  useEffect(() => {
    if (!enabled || !index) {
      setVisiblePrefs([]);
      return;
    }
    const update = () => {
      if (map.getZoom() < MUNI_BORDER_MIN_ZOOM) {
        setVisiblePrefs([]);
        return;
      }
      const b = map.getBounds();
      const prefs: number[] = [];
      for (const [pref, [w, s, e, n]] of Object.entries(index.prefBbox)) {
        if (b.getWest() <= e && b.getEast() >= w && b.getSouth() <= n && b.getNorth() >= s) {
          prefs.push(Number(pref));
        }
      }
      setVisiblePrefs(prefs);
      for (const p of prefs) {
        if (!muniChunks.has(p)) {
          loadChunk<FeatureCollection>(`muni-outline/pref-${String(p).padStart(2, '0')}.json`)
            .then((fc) => {
              muniChunks.set(p, fc);
              bump((n2) => n2 + 1);
            })
            .catch(() => {});
        }
      }
    };
    update();
    map.on('moveend zoomend', update);
    return () => {
      map.off('moveend zoomend', update);
    };
  }, [enabled, index, map]);

  if (!enabled) return null;
  return (
    <>
      {visiblePrefs
        .filter((p) => muniChunks.has(p))
        .map((p) => (
          <GeoJSON
            key={`muni-${p}`}
            data={muniChunks.get(p)!}
            interactive={false}
            style={{ color: '#64748b', weight: 1, opacity: 0.55, fillOpacity: 0, dashArray: '3 3' }}
          />
        ))}
    </>
  );
}

/** 出題範囲（選択した都道府県）が画面全体に入るようズームする。全国選択時はデフォルト表示 */
function RegionFit({ prefs, questionKey, revealed }: { prefs: number[]; questionKey: string; revealed: boolean }) {
  const map = useMap();
  const [index, setIndex] = useState<MuniOutlineIndex | null>(null);

  useEffect(() => {
    if (prefs.length === 0 || prefs.length >= 47) return;
    loadChunk<MuniOutlineIndex>('muni-outline/index.json').then(setIndex).catch(() => {});
  }, [prefs]);

  // 各問題の出題開始時に選択範囲へフィット（回答表示で寄ったズームを戻す）
  useEffect(() => {
    if (revealed || !index || prefs.length === 0 || prefs.length >= 47) return;
    let bounds: L.LatLngBounds | null = null;
    for (const p of prefs) {
      const bb = index.prefBbox[p];
      if (!bb) continue;
      const b = L.latLngBounds([bb[1], bb[0]], [bb[3], bb[2]]);
      bounds = bounds ? bounds.extend(b) : b;
    }
    if (bounds) map.fitBounds(bounds.pad(0.04));
  }, [index, prefs, questionKey, revealed, map]);
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
  quizId: QuizId;
  question: Question | null;
  revealed: boolean;
  pin: LatLng | null;
  hitMarks: HitMark[];
  missMarks: LatLng[];
  radiusKm: number;
  onPlacePin: (p: LatLng) => void;
  /** 出題範囲の都道府県。地図の初期表示をこの範囲にフィットさせる */
  prefs?: number[];
  /** ポリゴン系クイズ: カーソル下の区割りをハイライト */
  hoverKind?: HoverKind;
  hoverPrefs?: number[];
}

export function QuizMap({ quizId, question, revealed, pin, hitMarks, missMarks, radiusKm, onPlacePin, prefs, hoverKind, hoverPrefs }: QuizMapProps) {
  const hitIds = useMemo(() => new Set(hitMarks.map((h) => h.target.id)), [hitMarks]);
  const [settings, setSettings] = useState<MapSettings>(() => loadMapSettings(quizId));
  const { mapType, border: showBorder, muniBorder: showMuniBorder, rail: showRail, highway: showHighway } = settings;
  const [outline, setOutline] = useState<FeatureCollection | null>(null);
  const [hwLines, setHwLines] = useState<FeatureCollection | null>(null);
  // 高速道路線形は10万点級なので、このレイヤーだけ SVG でなく Canvas で描く
  const hwRenderer = useMemo(() => L.canvas({ padding: 0.5 }), []);

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

  useEffect(() => {
    if (!showHighway || hwLines) return;
    let cancelled = false;
    loadChunk<FeatureCollection>('highways/lines.json')
      .then((fc) => {
        if (!cancelled) setHwLines(fc);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showHighway, hwLines]);

  const updateSettings = (patch: Partial<MapSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(MAP_SETTINGS_KEY_PREFIX + quizId, JSON.stringify(next));
      return next;
    });
  };
  const changeMapType = (t: MapTypeId) => updateSettings({ mapType: t });
  const toggleBorder = (on: boolean) => updateSettings({ border: on });
  const toggleMuniBorder = (on: boolean) => updateSettings({ muniBorder: on });
  const toggleRail = (on: boolean) => updateSettings({ rail: on });
  const toggleHighway = (on: boolean) => updateSettings({ highway: on });

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

        {/* 鉄道強調オーバーレイ（透過タイル。zIndex でベース地図の上に固定） */}
        {showRail && (
          <TileLayer url={RAIL_URL} attribution={RAIL_ATTR} subdomains="abc" maxNativeZoom={19} zIndex={5} />
        )}

        {/* 県境強調オーバーレイ（クリックは地図へ素通し） */}
        {showBorder && outline && (
          <GeoJSON
            data={outline}
            interactive={false}
            style={{ color: '#e11d48', weight: 1.3, opacity: 0.65, fillOpacity: 0 }}
          />
        )}

        {/* 高速道路線形オーバーレイ（緑＝標識色。クリックは地図へ素通し）。renderer は PathOptions 経由で子 Polyline に届く */}
        {showHighway && hwLines && (
          <GeoJSON
            data={hwLines}
            interactive={false}
            style={{ color: '#059669', weight: 2, opacity: 0.75, renderer: hwRenderer }}
          />
        )}

        {/* 市町村境（ズーム時のみ・表示範囲の県だけ遅延ロード） */}
        <MuniBorders enabled={showMuniBorder} />

        {/* カーソル下の区割りハイライト（クイズごとの境界: 局番エリア/旧市町村/現市区町村） */}
        {hoverKind && hoverPrefs && hoverPrefs.length > 0 && (
          <HoverHighlight kind={hoverKind} prefs={hoverPrefs} active={!revealed} />
        )}

        {!revealed && <ClickHandler onClick={onPlacePin} />}
        {prefs && <RegionFit prefs={prefs} questionKey={question?.id ?? ''} revealed={revealed} />}
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
                  <div className="tt-label"><RubyText text={t.label} rubies={t.rubies} /></div>
                  {t.sublabel && <div className="tt-sub"><RubyText text={t.sublabel} rubies={t.sublabelRubies} /></div>}
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
                      <div className="tt-label"><RubyText text={t.label} rubies={t.rubies} /></div>
                      {t.sublabel && <div className="tt-sub"><RubyText text={t.sublabel} rubies={t.sublabelRubies} /></div>}
                    </Tooltip>
                  </Marker>
                )}
                {t.kind === 'point' && (
                  <Circle
                    center={[t.point[0], t.point[1]]}
                    radius={radiusKm * 1000}
                    pathOptions={{ color: wasHit ? '#1fa588' : '#e8a13d', weight: 1.5, fillOpacity: 0.08 }}
                  />
                )}
                {t.kind === 'polygon' && t.geom && (
                  <GeoJSON
                    data={t.geom}
                    style={{ color: wasHit ? '#1fa588' : '#e8a13d', weight: 2, fillOpacity: 0.18 }}
                  />
                )}
                {t.kind === 'line' && t.geom && (
                  <GeoJSON
                    data={t.geom}
                    style={{ color: wasHit ? '#1fa588' : '#e8a13d', weight: 3.5, opacity: 0.9 }}
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
          県境
        </label>
        <label className="map-control-check">
          <input type="checkbox" checked={showMuniBorder} onChange={(e) => toggleMuniBorder(e.target.checked)} />
          市町村境
        </label>
        <label className="map-control-check">
          <input type="checkbox" checked={showRail} onChange={(e) => toggleRail(e.target.checked)} />
          鉄道
        </label>
        <label className="map-control-check">
          <input type="checkbox" checked={showHighway} onChange={(e) => toggleHighway(e.target.checked)} />
          高速道路
        </label>
      </div>
    </>
  );
}
