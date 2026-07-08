# geo-japan-learning

GeoGuessr 日本マップ対策の地図クイズ SPA（駅名・市外局番・旧市町村・マンホール）。
公開リポジトリ（akkiira723/geo-japan-learning）。`main` への push で GitHub Pages に自動デプロイされる。

## スタック

Vite + React 18 + TypeScript + react-leaflet + react-router-dom。テストは vitest。
データ生成パイプラインは tsx（`scripts/`）。

## コマンド

- `npm run dev` / `npm run build`（`tsc -b && vite build`）/ `npm run preview` / `npm test`
- Windows: `vite preview` を起動したまま `npm run build` すると `dist/` がロックされ `EBUSY` で失敗する。ビルド前に preview を止めること。

## どこに何があるか

- クイズの内容・判定方式・データ出典・マンホール画像の選定基準 → `README.md`（重複させないのでそちらを参照）
- データパイプラインの規約・落とし穴 → `scripts/CLAUDE.md`（`scripts/` 配下を扱う時に自動で読み込まれる）
- データ再生成の具体的な手順 → `regenerate-data` スキルを使う（手順を都度その場で組み立てない）

## アーキテクチャ

クイズは `src/quizzes/index.ts` の `QUIZZES` レコードに `QuizModule`（`types.ts`）として登録される。
`useQuizEngine` がセッション状態（現在の設問・ミス回数・正誤）を管理し、`judge.ts` は純粋な幾何判定（点/ポリゴンの当たり判定）、
`storage.ts` が localStorage への唯一の入出力口。`public/data/` の生成 JSON は手動でコミットされたもので、
CI（`.github/workflows/deploy.yml`）はビルドのみを行い、データ再生成は一切しない。

<important if="public/data/配下のファイルを編集しようとしている場合">
`public/data/**` は生成物であり、直接手編集しない（設定でも拒否される）。
直すべきはアップストリームのスクリプト（`scripts/fetch|build`）か `scripts/overrides/*.json` で、直してから再生成する。
</important>

<important if="git操作や.github/workflows、デプロイに関わる変更をしている場合">
このリポジトリは公開かつ main push で自動デプロイされる。シークレットは絶対にコミットしない。
force-push・`reset --hard`・`clean -f`・`branch -D` 等の破壊的操作は hook で強制的にブロックされている
（`.claude/settings.json` — お願いではなく強制なので、代替手段を探すこと）。
</important>
