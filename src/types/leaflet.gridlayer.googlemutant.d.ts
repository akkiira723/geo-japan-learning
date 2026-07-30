// leaflet.gridlayer.googlemutant の ESM ビルドはクラスを default export する
// （L.gridLayer.googleMutant ファクトリは UMD 専用で ESM では動かない）。
// @types/leaflet.gridlayer.googlemutant は L 名前空間しか宣言しないため、ここで補う。
declare module 'leaflet.gridlayer.googlemutant' {
  import * as L from 'leaflet';

  export default class GoogleMutant extends L.GridLayer {
    constructor(options?: L.gridLayer.GoogleMutantOptions);
  }
}
