# Geo Japan Learning

GeoGuessr 日本マップ対策の地図クイズ。市外局番・旧市町村名・駅名を「地図クリック → Space で回答確定」の GeoGuessr 風操作で学習する。

## クイズ

| クイズ | 出題 | 判定 | 収録数 |
| --- | --- | --- | --- |
| 駅名 | 駅名（同名駅は全箇所回答） | 正解半径 10/20/50km の距離判定 | 約8,800駅（営業中、駅グループ単位） |
| 市外局番 | 局番（例: 0123） | エリアポリゴン内クリックで正解 | 388局番 |
| 旧市町村 | 消滅市町村名（同名は全箇所回答） | 旧市町村ポリゴン内クリックで正解 | 1,746件（1995年10月以降に消滅） |

共通機能: 地方・都道府県フィルタ、駅の事業者フィルタ（JR/JR以外）、地図タイプ切替（地理院 淡色/標準・CARTO Voyager・OSM）＋県境強調オーバーレイ、回答後の正解エリア表示、成績の localStorage 保存。

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # 判定ロジックの単体テスト
npm run build      # 型チェック + 本番ビルド（dist/）
```

## データ生成

生成済み JSON は `public/data/` にコミット済み。再生成するとき:

```bash
npm run data:stations   # 駅シート + station_database → public/data/stations/
npm run data:areacodes  # 市外局番表 + N03ポリゴン → public/data/areacodes/
npm run data:legacy     # Geoshapeスナップショット差分 → public/data/legacy/
```

- 生データは `data-cache/`（gitignore）にキャッシュされ、2回目以降はネットワーク不要
- 名寄せに失敗した名称が1件でもあるとビルドは失敗し、未解決リストを表示する。`scripts/overrides/*.json` に対応を追記して再実行する
- 市外局番エリアは市区町村単位の近似（実際の MA 境界とは一部異なる）。1市区町村が複数局番を持つ場合は双方の正解域に含める寛容判定

## デプロイ

`main` への push で GitHub Pages に自動デプロイ（`.github/workflows/deploy.yml`、base: `/geo-japan-learning/`）。リポジトリの Settings → Pages → Source を「GitHub Actions」にすること。

## データ出典

- 駅データ: [駅データ.jp](https://ekidata.jp/) 形式の公開スプレッドシート
- 路線・事業者: [station_database](https://github.com/Seo-4d696b75/station_database)（CC BY 4.0）
- 旧市町村ポリゴン: 『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447（CC BY 4.0）
- 市区町村ポリゴン: 国土数値情報 N03 を [japan-topography](https://github.com/smartnews-smri/japan-topography) 経由で加工
- 市外局番表: good-luck-day.com
- 地図タイル: 国土地理院 地理院タイル / © OpenStreetMap contributors / © CARTO
