/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps JS API キー（GitHub Secret / .env.local で注入。未設定なら Google 地図は選択肢に出ない） */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
