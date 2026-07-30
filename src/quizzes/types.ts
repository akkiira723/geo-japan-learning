import type { MultiLineString, MultiPolygon, Polygon } from 'geojson';

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * ふりがな1件: 表示文字列中に最初に現れる b の部分へ k（ひらがな）のルビを振る。
 * 郡名・路線名・道路名などの装飾部分は b に含めない（ルビ対象は地名コアのみ）。
 */
export interface Ruby {
  b: string;
  k: string;
}

/** クイズ1問の回答対象（同名駅・同名旧市町村は1問に複数入る） */
export interface Target {
  id: string;
  /** 回答後に表示する補足ラベル（例: "東京都 (JR山手線)" / "宮城県 大和町"） */
  label: string;
  /** label に振るふりがな（複数の地名を含むラベルは複数エントリ） */
  rubies?: Ruby[];
  /** ラベルの下に小さく表示する2行目（例: "現在: 北広島市"） */
  sublabel?: string;
  /** sublabel に振るふりがな */
  sublabelRubies?: Ruby[];
  kind: 'point' | 'polygon' | 'line';
  /** [lat, lng] 点ターゲットの座標 or ポリゴン・線形の代表点 */
  point: [number, number];
  /** [west, south, east, north] ポリゴン・線形のバウンディングボックス */
  bbox?: [number, number, number, number];
  geom?: Polygon | MultiPolygon | MultiLineString;
  /** テキスト回答式（answerMode='text'）の判定用正解テキスト（例: "北広島市"） */
  answer?: string;
  /** テキスト回答式の都道府県ヒント表示用（例: "北海道"。複数県は「・」区切り） */
  answerPref?: string;
  /** テキスト回答式: 出題元の都道府県コード。正解発表マップが muni-outline から所属市町村を引くのに使う */
  answerPrefCodes?: number[];
}

export interface Question {
  id: string;
  /** 出題文のメイン表示（例: "0123" / "広島町" / "大久保"） */
  prompt: string;
  /** prompt に振るふりがな（市外局番など地名でない prompt は省略） */
  promptRubies?: Ruby[];
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

export type QuizId = 'station' | 'areacode' | 'legacy' | 'legacyname' | 'manhole' | 'highway' | 'route';

export type OperatorFilter = 'all' | 'jr' | 'nonjr';

/** 高速道路クイズの施設種別（データチャンクと 1:1 対応） */
export type HighwayFacilityKind = 'ic' | 'jct' | 'sapa';

/** 高速道路クイズの道路タイプ（都市間高速 / 都市高速） */
export type HighwayRoadType = 'inter' | 'urban';

/** 国道番号クイズの番号帯（データチャンクと 1:1 対応） */
export type RouteBand = 'two' | 'three-low' | 'three-high';

export interface QuizFilter {
  prefs: number[];
  operator?: OperatorFilter;
  questionCount: number;
  /** 点ターゲットの正解半径 km（駅クイズの難易度） */
  radiusKm: number;
  /** 出題順。省略時はランダム（市外局番・国道番号クイズのみ 'asc' = 番号の昇順に対応） */
  order?: 'random' | 'asc';
  /** 市外局番の先頭2桁フィルタ（例: ['01', '02']）。空/省略はすべて */
  codePrefixes?: string[];
  /** 高速道路クイズの施設種別フィルタ。空/省略はすべて */
  facilityKinds?: HighwayFacilityKind[];
  /** 高速道路クイズの道路タイプフィルタ。空/省略はすべて */
  roadTypes?: HighwayRoadType[];
  /** 国道番号クイズの番号帯フィルタ。空/省略はすべて */
  routeBands?: RouteBand[];
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
  /** 国道番号向けの番号帯・出題順フィルタを出すか */
  hasRouteFilters?: boolean;
  /**
   * 回答方式。'select' = ホバーでハイライトした線形をクリックで選択し、
   * 選択 id とターゲット id の一致で判定（正解半径は使わない）。
   * 'text' = 地図を使わずテキスト入力の完全一致で判定（TextQuizShell）。省略 = 従来のクリック地点判定
   */
  answerMode?: 'select' | 'text';
  /** 選択式のミス表示用: 選択 id を表示名にする（例: '15' → '国道15号'） */
  selectionLabel?: (id: string) => string;
  /** マウスホバーでハイライトする区割り（ポリゴン系クイズのみ） */
  hoverKind?: HoverKind;
}

export interface QuizModule {
  meta: QuizMeta;
  loadQuestions(filter: QuizFilter): Promise<Question[]>;
}
