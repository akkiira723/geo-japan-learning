import { Link } from 'react-router-dom';

export function About() {
  return (
    <div className="page about">
      <h1>このツールについて</h1>
      <p>
        GeoGuessr の日本マップ攻略に役立つ「市外局番」「旧市町村名」「駅名」「高速道路施設」を、地図クリック型クイズで学習する個人用ツールです。
      </p>

      <h2>データ出典</h2>
      <ul className="source-list">
        <li>
          駅データ: <a href="https://ekidata.jp/" target="_blank" rel="noreferrer">駅データ.jp</a> 形式の公開スプレッドシートをもとに加工
        </li>
        <li>
          路線・事業者情報・駅名の読み仮名: <a href="https://github.com/Seo-4d696b75/station_database" target="_blank" rel="noreferrer">station_database</a>（CC BY 4.0）
        </li>
        <li>
          市区町村名の読み仮名（現行・消滅自治体）: <a href="https://data.e-stat.go.jp/lod/" target="_blank" rel="noreferrer">e-Stat 統計LOD</a> 標準地域コード
        </li>
        <li>
          高速道路施設の読み仮名: OpenStreetMap（name:ja-Hira）および{' '}
          <a href="https://ja.wikipedia.org/wiki/日本のインターチェンジ一覧_あ行" target="_blank" rel="noreferrer">Wikipedia「日本のインターチェンジ一覧」</a>・
          <a href="https://ja.wikipedia.org/wiki/日本のサービスエリア・パーキングエリア一覧" target="_blank" rel="noreferrer">「日本のサービスエリア・パーキングエリア一覧」</a>（CC BY-SA 4.0）
        </li>
        <li>
          旧市町村ポリゴン: 『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447（CC BY 4.0）
        </li>
        <li>
          市区町村ポリゴン: 国土交通省「国土数値情報（行政区域データ N03）」を{' '}
          <a href="https://github.com/smartnews-smri/japan-topography" target="_blank" rel="noreferrer">japan-topography</a> 経由で加工
        </li>
        <li>
          高速道路施設（IC・JCT・SA/PA）: ©{' '}
          <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors（ODbL）を
          Overpass API 経由で取得・加工
        </li>
        <li>
          マンホール画像: <a href="https://we-love-manho.com/" target="_blank" rel="noreferrer">日本マンホール蓋学会</a>
          （画像の権利は同会・各撮影者に帰属。本ツールは画像を複製・再配布せず同サイトから直接表示し、各問題に出典ページへのリンクを表示します）
        </li>
        <li>
          地図タイル: <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors /{' '}
          <a href="https://tile.openstreetmap.jp/" target="_blank" rel="noreferrer">OSMFJ タイルサーバー</a>（日本語スタイル）/{' '}
          <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院 地理院タイル</a> /{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">CARTO</a>
        </li>
      </ul>

      <h2>注意事項</h2>
      <ul>
        <li>市外局番エリアは市区町村単位の近似であり、実際の番号区画（MA）境界とは一部異なります。</li>
        <li>1つの市区町村が複数の市外局番を持つ場合、いずれの局番でもその市区町村を正解として扱います。</li>
        <li>高速道路施設は OpenStreetMap 由来のため、実際の名称・位置と一部異なる場合があります。</li>
        <li>地名のふりがなは出典データに基づきますが、一部の高速道路施設など読みが取得できないものは表示されません。</li>
        <li>成績はこのブラウザの localStorage にのみ保存されます。</li>
      </ul>

      <p>
        <Link to="/changelog">変更履歴</Link>
      </p>
      <Link to="/">ホームへ戻る</Link>
    </div>
  );
}
