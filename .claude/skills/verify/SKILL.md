---
name: verify
description: geo-japan-learning の変更を実アプリ（ブラウザ）で end-to-end 検証する手順。dev サーバーの起動、Playwright + Edge での画面駆動、クイズ開始までの操作、スクリーンショット取得のレシピ。
---

# 実アプリ検証レシピ

## 起動

```bash
npm run dev   # http://localhost:5173/geo-japan-learning/ （HashRouter なので URL は #/quiz/<id>）
```

ルート: `#/quiz/station|highway|areacode|legacy|manhole`、`#/cards/manhole`。

## ブラウザ駆動

Playwright のブラウザバイナリは未インストールだが、**`channel: 'msedge'` で Windows 標準の Edge が使える**（ダウンロード不要）:

```js
import { chromium } from 'playwright'; // scratchpad で npm install playwright --no-save
const browser = await chromium.launch({ channel: 'msedge', headless: true });
```

## クイズ開始までの操作

- 高速道路クイズ（nationwide）は設定画面からそのまま「スタート」を押せる
- 駅・市外局番・旧市町村・マンホールは**出題範囲を選ぶまでスタートボタンが disabled**。
  地方チップ（`button.chip`、例: 「関東」）をクリックしてから
  `page.getByRole('button', { name: 'スタート' })` を押す

## 地図まわりのセレクタ

- オーバーレイトグル: `label.map-control-check`（県境 / 市町村境 / 鉄道 / 高速道路）に `input` が入る
- 地図設定の localStorage キー: `geo-japan-learning:mapsettings:<quizId>`（クイズ別）。
  デフォルト値の検証はこのキーを消してからリロードする
- ズーム: `.leaflet-control-zoom-in` をクリック（map インスタンスには外から触れない）

## 落とし穴

- **クイズ間をハッシュ URL 直接遷移**（`#/quiz/highway` → `#/quiz/station`）すると QuizPage/QuizMap が
  再マウントされず、地図設定 state が前のクイズから引き継がれる（既存挙動。通常の Home 経由遷移では起きない）。
  クイズごとのデフォルト検証は必ずフルリロード（`page.goto` + `page.reload()`）で行う
- `npm run preview` を起動したまま `npm run build` すると EBUSY（dev サーバーは無害）
