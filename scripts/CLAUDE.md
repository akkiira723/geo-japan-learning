# scripts/ — データ生成パイプライン

外部ソースを `data-cache/`（gitignore、再開可能）に fetch し、`public/data/*.json`（コミット対象）に build する。
CI では絶対に実行しない。ローカルで実行し、`public/data/` の差分をコミットする運用。

## パターン

`npm run data:*` はそれぞれ `fetch/*.ts`（ネットワーク I/O → `data-cache/`）→ `build/*.ts`（`data-cache/` → `public/data/*.json`）の順で1本のスクリプトを2段実行する。
`fetch-muni-geo.ts` は `data:areacodes` と `data:outline` で共有されるので、両方古い場合でも二重に取得し直す必要はない。

## 名寄せ（override）運用

build スクリプトは名前解決に失敗した項目が1件でもあると exit 1 し、未解決リストを表示する。
対応は該当する `scripts/overrides/*.json` に entry を追記して再実行すること。
`scripts/lib/normalize.ts` 等のマッチングロジック自体は全ソース共通なので、1件のミスマッチのために触らない。

## ソース別の落とし穴

- **駅**: スプレッドシートのタブ名は英語ではなく「駅」。存在しない gviz シート名を指定すると 404 ではなく約8.7KBのエラー応答が返ってくるので、データに見えて実はエラーというケースに注意。
- **市外局番**: 一次資料は総務省「市外局番の一覧」PDF（`fetch-area-codes.ts` が pdfjs-dist で表をパース。市外局番列は先頭の 0 が省略されている）。区画テキストの文法（除く/限る/及び/丁目範囲/入れ子括弧）は `lib/soumu-kukaku.ts` が解釈する。複数局番に分割される市町村（約150）は国勢調査小地域を `fetch-chocho-geo.ts` で取得して切り分けるため、**build は fetch-muni-geo・fetch-legacy-geo・fetch-chocho-geo の3つのキャッシュ全部に依存する**（`npm run data:areacodes` が正しい順で実行する）。小地域名の照合は多段フォールバック（丁目/大字/字の正規化 → 前方・後方一致 → 旧市町村ポリゴン重心内包）で、未解決は `overrides/areacode-muni-fixes.json`（市町村名）と `overrides/areacode-chocho-fixes.json`（大字等。値 `null`=無視、`旧:○○町`=旧市町村ポリゴン強制）に追記する。小地域由来のポリゴンは build 内で DP 簡略化（tol=1e-4）しないと出力が10倍に膨らむ。
- **旧市町村**: 個別 GeoJSON ではなく `jp_city.c.topojson`（歴史的行政区域データセットβ版/Geoshape、約3MB）を一括利用する。「消滅」判定は JIS コードの 1995/2000 vs 2023 スナップショット差分。同名の後継は村→町→市の**同格以上**のみ後継として扱う（例: 清水市を、格下の駿東郡清水町の後継として誤って除外しない）。
- **マンホール**（we-love-manho.com をクロール、画像は再配布せずホットリンクのみ）: 県indexページは通常 `{d}/{d}.html`。11県は `{d}itirann.html`。東京だけ `toukyou/toitirann.html`（`toukyou/to.html` は都章ページで別物、混同注意）。マンホール**カード**（別の収集物）・ポケふた・展示専用蓋・ページと自治体が食い違う蓋は除外する。北海道の一覧にかな見出しが混入するケース、「規格」「その他」ページは別パース処理が必要な点にも注意。
- **高速道路**（OSM Overpass API）: IC/JCT は `motorway_junction` ノード、SA/PA は `services|rest_area`。親 way（道路名・operator）は全国一括クエリだと 504/応答途切れが頻発するため、junction ノード ID を 500 件ずつのバッチで問い合わせて `ways-part-*.json` に分割キャッシュし `ways.json` にマージする。エンドポイントは overpass-api.de → kumi.systems → osm.jp をローテーション（429/504 で次へ。osm.jp は証明書切れのことがある）。空 elements や `remark` 付き応答はキャッシュに書かない（エラーがデータに見える事故防止）。名前の正規化はコード側（`lib/highway.ts`: 方向サフィックス除去・入口/出口→出入口・料金所/BS 除外）で行い、すり抜けは `overrides/highway-fixes.json`（`exclude`/`rename`、キーは OSM id `n123…`）。キャッシュ無効化は `data-cache/highway/` を削除。build は pref 判定に `data-cache/geo/muni/` にも依存する（`npm run data:highways` が正しい順で実行する）。
- **マンホール画像品質フィルタ**（`scripts/lib/image.ts`）: `circleScore < 0.35` は無条件除外、`< 0.6` はキャプションに「ノンカラー等の蓋以外を示す語」があり「蓋を示す語」がない場合のみ除外。取りこぼしは `scripts/overrides/manhole-img-excludes.json` に URL 単位で追加し、`result` キャッシュを再生成する。`resolveAboveRef` は「上記の〜」のような直前画像への参照キャプションを、直前画像の説明文を引用する形で解決する。`parsePairs` はキャプション中に紛れ込む gif バッジ等の `<img>` タグを除去している — ここを触るとキャプション欠落が再発するので、変更時は出力キャプションを必ず確認する。

## 詳しい手順

データ再生成の具体的な実行順序・キャッシュ無効化・完了チェックリストは `regenerate-data` スキルを使うこと（このファイルには載せない）。
