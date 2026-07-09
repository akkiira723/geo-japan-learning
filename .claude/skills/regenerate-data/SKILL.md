---
name: regenerate-data
description: geo-japan-learning のクイズデータ（駅・市外局番・旧市町村・マンホール）を再生成する手順書。npm run data:* の実行順序、名寄せ未解決の対処、Windows特有のEBUSY、マンホールのキャッシュ無効化、コミット前チェックリストをまとめる。データを再生成したい、scripts/overrides/*.json を編集した後、名寄せエラーが出た、と言われたときに使う。
---

# データ再生成手順

`public/data/` の生成 JSON はコミット済みで、CI では再生成されない。ここでの作業結果がそのまま次のデプロイに乗る。

## 使う場面

- 5つの `npm run data:*`（stations / areacodes / legacy / outline / manholes）のいずれかを再実行するとき
- `scripts/overrides/*.json` を編集した後の再実行

## 依存関係の注意

- `fetch-muni-geo.ts` は `data:areacodes` と `data:outline` の両方から使われる。両方を再生成する必要がある場合、先に片方を実行して `data-cache/` を温めておけば、もう片方は再フェッチを省略できる。
- `data:areacodes` は fetch を4段（総務省PDF → N03 → 歴史的行政区域 → 国勢調査小地域）踏む。小地域（`data-cache/geo/chocho/`）は「複数局番に分割される市町村」の分だけ取得される（約160ファイル）。総務省が PDF を更新した場合は `data-cache/raw/soumu-areacodes.pdf` と `areacodes.json` を消してから再実行する（URL は `fetch-area-codes.ts` 冒頭。改版で URL 自体が変わることがある）。

## 名寄せ（override）の往復ループ

1. `npm run data:<target>` を実行する
2. 未解決の名前が1件でもあると build スクリプトが exit 1 し、一覧が表示される
3. 該当する `scripts/overrides/*.json`（`legacy-fixes.json` / `manhole-fixes.json` / `areacode-muni-fixes.json`〔市町村名〕 / `areacode-chocho-fixes.json`〔大字等。値 `null`=無視、`["旧:○○町"]`=旧市町村ポリゴン照合〕）に entry を追記する。areacode の大字は実在しない（国勢調査に痕跡がない）ことも多く、その場合は包含/除外の両リストに同名で載っていて打ち消し合うので `null` で安全に無視できる
4. 1〜3 をクリーンになるまで繰り返す

**未解決リストが概ね15〜20件を超える場合**は、生リストをそのままメインの会話に貼らずに Subagent へ委譲する。生データと該当ソース（対象の CSV/シート/クロール結果）を渡し、「タイプミス／自治体名変更／本当に欠落」に分類させ、構造化された結果だけを受け取ること。調査ログでメインコンテキストを汚さない。

## Windows: EBUSY

`npm run preview` を起動したままだと `dist/` がロックされ、`npm run build` が `rmSync` の `EBUSY` で失敗する。データ再生成や build の前に preview を停止しておく。

## マンホール専用: キャッシュ無効化

画像選定ロジック（`scripts/lib/image.ts`）を直した後などに `manholes` の `result` を作り直す場合:

1. `data-cache/manho/result/*.json` を退避する（削除ではなく移動が安全）
2. `npm run data:manholes` の fetch を再実行する（ページ/画像キャッシュが温まっていれば数分で終わる）
3. 画像は re-download しても再配布はしない — 生成物は出典 URL への参照のみ

## 完了後チェックリスト

- [ ] `npm test` が通る
- [ ] `public/data/` の差分（追加・削除・サイズ）を目視し、想定外の大量削除や空データになっていないか確認する
- [ ] コミットメッセージに再生成対象とデータ件数の変化を明記する
