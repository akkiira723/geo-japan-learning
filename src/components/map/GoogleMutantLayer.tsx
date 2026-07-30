import L from 'leaflet';
import 'leaflet.gridlayer.googlemutant';
import { importLibrary, setOptions } from '@googlemaps/js-api-loader';
import { useEffect } from 'react';
import { useMap } from 'react-leaflet';

/** ビルド時に注入される Google Maps API キー。未設定時は Google 地図の選択肢自体を出さない */
export const GOOGLE_MAPS_API_KEY: string | undefined =
  import.meta.env.VITE_GOOGLE_MAPS_API_KEY || undefined;

export type GoogleMapType = 'roadmap' | 'hybrid';

let apiPromise: Promise<unknown> | null = null;

/** Maps JS API はページ内で一度だけロードする（GoogleMutant が window.google.maps を参照する） */
function loadGoogleMapsApi(): Promise<unknown> {
  if (!apiPromise) {
    setOptions({ key: GOOGLE_MAPS_API_KEY ?? '', language: 'ja', region: 'JP' });
    apiPromise = importLibrary('core').then(() => importLibrary('maps'));
  }
  return apiPromise;
}

/** Leaflet の上に本物の Google マップを敷くベースレイヤー（Leaflet.GridLayer.GoogleMutant） */
export function GoogleMutantLayer({ type }: { type: GoogleMapType }) {
  const map = useMap();

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY) return;
    let cancelled = false;
    let layer: L.GridLayer | null = null;
    loadGoogleMapsApi()
      .then(() => {
        if (cancelled) return;
        layer = L.gridLayer.googleMutant({ type });
        layer.addTo(map);
      })
      .catch((e) => {
        console.warn('Google Maps の読み込みに失敗しました', e);
      });
    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [map, type]);

  return null;
}
