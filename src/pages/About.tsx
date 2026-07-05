import { Link } from 'react-router-dom';

export function About() {
  return (
    <div className="page about">
      <h1>このツールについて</h1>
      <p>
        GeoGuessr の日本マップ攻略に役立つ「市外局番」「旧市町村名」「駅名」を、地図クリック型クイズで学習する個人用ツールです。
      </p>

      <h2>データ出典</h2>
      <ul className="source-list">
        <li>
          駅データ: <a href="https://ekidata.jp/" target="_blank" rel="noreferrer">駅データ.jp</a> 形式の公開スプレッドシートをもとに加工
        </li>
        <li>
          路線・事業者情報: <a href="https://github.com/Seo-4d696b75/station_database" target="_blank" rel="noreferrer">station_database</a>（CC BY 4.0）
        </li>
        <li>
          旧市町村ポリゴン: 『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447（CC BY 4.0）
        </li>
        <li>
          市区町村ポリゴン: 国土交通省「国土数値情報（行政区域データ N03）」を{' '}
          <a href="https://github.com/smartnews-smri/japan-topography" target="_blank" rel="noreferrer">japan-topography</a> 経由で加工
        </li>
        <li>
          地図タイル: <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院 地理院タイル</a>（淡色・標準）/{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors /{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>
        </li>
      </ul>

      <h2>注意事項</h2>
      <ul>
        <li>市外局番エリアは市区町村単位の近似であり、実際の番号区画（MA）境界とは一部異なります。</li>
        <li>1つの市区町村が複数の市外局番を持つ場合、いずれの局番でもその市区町村を正解として扱います。</li>
        <li>成績はこのブラウザの localStorage にのみ保存されます。</li>
      </ul>

      <Link to="/">ホームへ戻る</Link>
    </div>
  );
}
