# Geo Japan Learning

GeoGuessr 日本マップ対策の地図クイズ。市外局番・旧市町村名・駅名を「地図クリック → Space で回答確定」の GeoGuessr 風操作で学習する。

## クイズ

| クイズ | 出題 | 判定 | 収録数 |
| --- | --- | --- | --- |
| 駅名 | 駅名（同名駅は全箇所回答） | 正解半径 3/10/20km の距離判定 | 約8,800駅（営業中、駅グループ単位） |
| 市外局番 | 局番（例: 0123） | エリアポリゴン内クリックで正解 | 387局番 |
| 旧市町村 | 消滅市町村名（同名は全箇所回答） | 旧市町村ポリゴン内クリックで正解 | 1,746件（1995年10月以降に消滅） |
| マンホール | ご当地マンホール写真 | 自治体ポリゴン内クリックで正解 | 各自治体 市章蓋1枚＋デザイン蓋最大3枚 |

共通機能: 地方・都道府県フィルタ、駅の事業者フィルタ（JR/JR以外）、市外局番は出題範囲を地方/都道府県/局番帯（01台〜09台。03・06 は単独局番のため帯なし）のいずれかで選択+出題順（ランダム/局番の昇順）、地図タイプ切替（OSM Bright 日本語・ベーシック日本語・地理院 淡色/標準・CARTO Voyager・OSM）＋県境・市町村境オーバーレイ、回答後の正解エリア表示、成績の localStorage 保存。

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
npm run data:outline    # 県境・市町村境オーバーレイ → public/data/prefs-outline.json ほか
npm run data:manholes   # 日本マンホール蓋学会をクロール（1時間弱・再開可能） → public/data/manholes/
```

マンホールクイズの画像選定基準（`scripts/fetch/fetch-manholes.ts`）:

- マンホールカード・ポケふた・展示蓋・越境蓋は除外
- 色付き蓋は除外（説明文の「カラー」表記＋画像の彩度解析の両方で判定）
- 同デザインの変種（「上記の〜」小型・受枠違い・親子等）は除外し1デザイン1枚。知覚ハッシュ（dHash）でも重複排除
- 市章入り蓋は各自治体1枚、デザイン蓋は各自治体最大3枚
- 画像は再配布せず、出典サイトから直接表示（各問題に出典リンクを表示）

- 生データは `data-cache/`（gitignore）にキャッシュされ、2回目以降はネットワーク不要
- 名寄せに失敗した名称が1件でもあるとビルドは失敗し、未解決リストを表示する。`scripts/overrides/*.json` に対応を追記して再実行する
- 市外局番エリアは総務省「市外局番の一覧」PDF の番号区画に基づく。基本は市区町村単位で解決し、1市区町村が複数局番に分かれる場合（約150市町村）は国勢調査小地域（町丁・字等）ポリゴンで切り分ける。小地域名で照合できない旧町名（例: 登米市石越町）は歴史的行政区域の旧市町村ポリゴンへのフォールバックで解決

## デプロイ

`main` への push で GitHub Pages に自動デプロイ（`.github/workflows/deploy.yml`、base: `/geo-japan-learning/`）。リポジトリの Settings → Pages → Source を「GitHub Actions」にすること。

## データ出典

- 駅データ: [駅データ.jp](https://ekidata.jp/) 形式の公開スプレッドシート
- 路線・事業者: [station_database](https://github.com/Seo-4d696b75/station_database)（CC BY 4.0）
- 旧市町村ポリゴン: 『歴史的行政区域データセットβ版』（CODH作成）doi:10.20676/00000447（CC BY 4.0）
- 市区町村ポリゴン: 国土数値情報 N03 を [japan-topography](https://github.com/smartnews-smri/japan-topography) 経由で加工
- 市外局番の区画: 総務省「[市外局番の一覧](https://www.soumu.go.jp/main_content/000141817.pdf)」
- 町丁・字等（小地域）ポリゴン: 国勢調査2020 小地域境界データを [Geoshape](https://geoshape.ex.nii.ac.jp/ka/) 経由で加工
- 地図タイル: © OpenStreetMap contributors / OSMFJ タイルサーバー（日本語スタイル） / 国土地理院 地理院タイル / © CARTO
