import type { MultiPolygon, Polygon } from 'geojson';

export interface LatLng {
  lat: number;
  lng: number;
}

/** クイズ1問の回答対象（同名駅・同名旧市町村は1問に複数入る） */
export interface Target {
  id: string;
  /** 回答後に表示する補足ラベル（例: "東京都 (JR山手線)" / "宮城県 大和町"） */
  label: string;
  /** ラベルの下に小さく表示する2行目（例: "現在: 北広島市"） */
  sublabel?: string;
  kind: 'point' | 'polygon';
  /** [lat, lng] 点ターゲットの座標 or ポリゴンの代表点 */
  point: [number, number];
  /** [west, south, east, north] ポリゴンのバウンディングボックス */
  bbox?: [number, number, number, number];
  geom?: Polygon | MultiPolygon;
}

export interface Question {
  id: string;
  /** 出題文のメイン表示（例: "0123" / "広島町" / "大久保"） */
  prompt: string;
  /** 出題の補足（例: "市外局番" / "駅名"） */
  sub?: string;
  /** 出題画像（マンホールクイズ）。地図の左上にパネル表示される */
  image?: string;
  /** 画像の出典ページ（回答後にリンク表示） */
  imageLink?: string;
  /** 画像の説明文（回答後に表示） */
  imageDesc?: string;
  targets: Target[];
}

export type QuizId = 'station' | 'areacode' | 'legacy' | 'manhole' | 'highway';

export type OperatorFilter = 'all' | 'jr' | 'nonjr';

/** 高速道路クイズの施設種別（データチャンクと 1:1 対応） */
export type HighwayFacilityKind = 'ic' | 'jct' | 'sapa';

/** 高速道路クイズの道路タイプ（都市間高速 / 都市高速） */
export type HighwayRoadType = 'inter' | 'urban';

export interface QuizFilter {
  prefs: number[];
  operator?: OperatorFilter;
  questionCount: number;
  /** 点ターゲットの正解半径 km（駅クイズの難易度） */
  radiusKm: number;
  /** 出題順。省略時はランダム（市外局番クイズのみ 'asc' = 局番の昇順に対応） */
  order?: 'random' | 'asc';
  /** 市外局番の先頭2桁フィルタ（例: ['01', '02']）。空/省略はすべて */
  codePrefixes?: string[];
  /** 高速道路クイズの施設種別フィルタ。空/省略はすべて */
  facilityKinds?: HighwayFacilityKind[];
  /** 高速道路クイズの道路タイプフィルタ。空/省略はすべて */
  roadTypes?: HighwayRoadType[];
}

export type HoverKind = 'areacode' | 'legacy' | 'muni';

export interface QuizMeta {
  id: QuizId;
  title: string;
  description: string;
  /** 点判定クイズか（難易度=半径の設定 UI を出すか） */
  usesRadius: boolean;
  /** 事業者フィルタを出すか */
  hasOperatorFilter: boolean;
  /** 市外局番向けの出題順・局番帯フィルタを出すか */
  hasAreaCodeFilters?: boolean;
  /** 全国一律出題（都道府県・地方の選択 UI を出さない） */
  nationwide?: boolean;
  /** 高速道路向けの施設種別・道路タイプフィルタを出すか */
  hasHighwayFilters?: boolean;
  /** マウスホバーでハイライトする区割り（ポリゴン系クイズのみ） */
  hoverKind?: HoverKind;
}

export interface QuizModule {
  meta: QuizMeta;
  loadQuestions(filter: QuizFilter): Promise<Question[]>;
}
