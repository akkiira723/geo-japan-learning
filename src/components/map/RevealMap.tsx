import L from 'leaflet';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import { useEffect, useState } from 'react';
import { GeoJSON, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import { loadChunk } from '../../hooks/useChunkLoader';
import type { Target } from '../../quizzes/types';
import { RubyText } from '../quiz/RubyText';

const TILE_URL = 'https://tile.openstreetmap.jp/styles/maptiler-basic-ja/{z}/{x}/{y}{r}.png';
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors' +
  ' / tiles by <a href="https://tile.openstreetmap.jp/" target="_blank" rel="noreferrer">OSMFJ</a>';

type Bbox = [number, number, number, number];

interface MuniOutlineIndex {
  prefBbox: Record<string, Bbox>;
}

/** 正解の所属市町村ポリゴン1件（政令市を市名で答える場合は区ごとに複数件になる） */
interface MuniHighlight {
  key: string;
  name: string;
  geom: Polygon | MultiPolygon;
}

const bboxIntersects = (a: Bbox, b: Bbox) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

/**
 * muni-outline の feature 名が答えの市町村に属するか。
 * 政令市は区単位で収録されているので、市名の答え（例: 浜松市）は全区を前方一致で拾う。
 */
function nameMatches(featureName: string, answer: string): boolean {
  if (featureName === answer) return true;
  return featureName.startsWith(answer) && featureName.slice(answer.length).endsWith('区');
}

/**
 * 各ターゲットの所属市町村ポリゴンを muni-outline から名前で引く。
 * 探す県は出題元の県 + ターゲット bbox に重なる県（山口村→中津川市のような県またぎ編入対応）。
 */
async function loadMuniHighlights(targets: Target[]): Promise<MuniHighlight[]> {
  const wanted = targets.filter((t) => t.answer && t.answerPrefCodes?.length);
  if (wanted.length === 0) return [];
  const index = await loadChunk<MuniOutlineIndex>('muni-outline/index.json');

  const candidatePrefs = (t: Target): number[] => {
    const prefs = new Set(t.answerPrefCodes);
    if (t.bbox) {
      for (const [pref, bb] of Object.entries(index.prefBbox)) {
        if (bboxIntersects(t.bbox, bb)) prefs.add(Number(pref));
      }
    }
    return [...prefs];
  };

  const allPrefs = [...new Set(wanted.flatMap(candidatePrefs))];
  const chunks = new Map<number, FeatureCollection<Polygon | MultiPolygon, { n?: string }>>();
  await Promise.all(
    allPrefs.map(async (p) => {
      try {
        chunks.set(
          p,
          await loadChunk<FeatureCollection<Polygon | MultiPolygon, { n?: string }>>(
            `muni-outline/pref-${String(p).padStart(2, '0')}.json`,
          ),
        );
      } catch {
        // 取得失敗時はその県のハイライトだけ諦める
      }
    }),
  );

  const out: MuniHighlight[] = [];
  for (const t of wanted) {
    for (const p of candidatePrefs(t)) {
      const fc = chunks.get(p);
      if (!fc) continue;
      fc.features.forEach((f, i) => {
        if (f.properties?.n && nameMatches(f.properties.n, t.answer!)) {
          out.push({ key: `${t.id}:${p}:${i}`, name: t.answer!, geom: f.geometry });
        }
      });
    }
  }
  return out;
}

/** 全ターゲットと所属市町村が収まるようにズームを合わせる */
function FitToTargets({ targets, munis }: { targets: Target[]; munis: MuniHighlight[] }) {
  const map = useMap();
  useEffect(() => {
    if (targets.length === 0) return;
    let bounds = L.latLngBounds(targets.map((t) => [t.point[0], t.point[1]] as [number, number]));
    for (const t of targets) {
      if (t.bbox) {
        bounds = bounds.extend(L.latLngBounds([t.bbox[1], t.bbox[0]], [t.bbox[3], t.bbox[2]]));
      }
    }
    for (const m of munis) {
      bounds = bounds.extend(L.geoJSON(m.geom).getBounds());
    }
    // animate: false — ズームアニメーション中に次の問題へ進んでマップが破棄されると
    // Leaflet が _leaflet_pos 参照エラーを投げるため、即時フィットにする
    map.fitBounds(bounds.pad(0.2), { maxZoom: 10, animate: false });
  }, [targets, munis, map]);
  return null;
}

/**
 * 正解発表用の小型マップ。テキスト回答式クイズで、正解の旧市町村ポリゴンを
 * ハイライト表示する（正解済み=緑 / 未回答=橙。色は QuizMap の回答後表示と揃える）。
 * あわせて所属する現市町村の輪郭を黒でハイライトする。
 */
export function RevealMap({ targets, solvedIds }: { targets: Target[]; solvedIds: ReadonlySet<string> }) {
  const [munis, setMunis] = useState<MuniHighlight[]>([]);

  useEffect(() => {
    let cancelled = false;
    setMunis([]);
    loadMuniHighlights(targets)
      .then((m) => {
        if (!cancelled) setMunis(m);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [targets]);

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
      <FitToTargets targets={targets} munis={munis} />

      {/* 所属する現市町村（黒）。旧市町村ポリゴンより下に描く */}
      {munis.map((m) => (
        <GeoJSON
          key={m.key}
          data={m.geom}
          style={{ color: '#26363a', weight: 2.5, opacity: 0.85, fillColor: '#26363a', fillOpacity: 0.05 }}
        >
          <Tooltip sticky>{m.name}</Tooltip>
        </GeoJSON>
      ))}

      {targets.map((t) => {
        if (!t.geom) return null;
        const solved = solvedIds.has(t.id);
        return (
          <GeoJSON
            key={t.id}
            data={t.geom}
            style={{ color: solved ? '#1fa588' : '#e8a13d', weight: 2, fillOpacity: 0.25 }}
          >
            {/* 常時表示だと地図を隠すので、ホバー時のみラベルを出す */}
            <Tooltip sticky>
              <div className="tt-label">
                <RubyText text={t.label} rubies={t.rubies} />
              </div>
            </Tooltip>
          </GeoJSON>
        );
      })}
    </MapContainer>
  );
}
