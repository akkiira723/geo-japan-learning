import { haversineKm } from '../../src/lib/judge.ts';

export type HighwayKind = 'ic' | 'jct' | 'sa' | 'pa';

/**
 * 末尾の方向サフィックスを除去する（上下線・内外回り別ノードを同一施設に名寄せするため）。
 * 例: 「海老名SA（下り）」→「海老名SA」、「加平出入口 外回り」→「加平出入口」
 */
export function stripDirection(name: string): string {
  let n = name.trim();
  const re =
    /[\s　]*[（(]?(上り|下り|上下線?|外回り|内回り|東行き?|西行き?|南行き?|北行き?|[東西南北]京?方面(行き?)?)(線|方向)?[）)]?$/;
  for (let prev = ''; prev !== n; ) {
    prev = n;
    n = n.replace(re, '').trim();
  }
  return n;
}

/**
 * 都市高速の「○○入口」「○○出口」（別ノード）を「○○出入口」に正規化して1施設に名寄せする。
 * 末尾が既に「出入口」のものはそのまま。それ以外の名前は変更しない。
 */
export function normalizeGate(name: string): string {
  const m = name.match(/^(.+?)(出入口|入口|出口)$/);
  if (!m) return name;
  return `${m[1]}出入口`;
}

/**
 * 都市高速の出入口名の表記ゆれを正規化する。OSM は「霞が関出入口」と裸の「霞が関」が
 * 混在しており別施設として重複するため、サフィックスの無い名前に「出入口」を付けて名寄せする。
 * IC/インター/ランプ等の別サフィックスを持つ名前はそのまま
 */
export function canonicalUrbanGateName(name: string): string {
  if (/(IC|JCT|インター|ランプ|出入口|SA|PA)$/.test(name)) return name;
  return `${name}出入口`;
}

/**
 * stripDirection + normalizeGate。build が表示名・名寄せキーの両方に使う。
 * OSM には「豊川ＩＣ」「赤塚ＰＡ」のような全角英字表記が混在するため NFKC で半角に揃える
 */
export function normalizeFacilityName(name: string): string {
  return normalizeGate(stripDirection(name.normalize('NFKC')));
}

/** 料金所・検札所・バスストップ・非常口など、クイズ対象外の施設名か */
export function isExcludedName(name: string): boolean {
  const n = name.normalize('NFKC');
  if (/料金所|検札所|TB$|バリア$/.test(n)) return true;
  if (/(BS|バスストップ|バス停)$/.test(n)) return true;
  if (/非常口|避難/.test(n)) return true;
  // サフィックス除去後に固有名が残らないもの（「出口」「入口」だけ等）
  if (/^(出入口|入口|出口|ランプ|IC|JCT|SA|PA)$/.test(normalizeFacilityName(n))) return true;
  return false;
}

/**
 * services|rest_area 要素が高速道路の SA/PA か。OSM の rest_area は道の駅・
 * 一般道の駐車帯・コインパーキングにも使われているため、SA/PA 系の名称だけを採用する
 */
export function isExpresswayRestArea(name: string): boolean {
  const n = name.normalize('NFKC');
  if (/道の駅/.test(n)) return false;
  return /SA(?![A-Za-z])|PA(?![A-Za-z])|サービスエリア|パーキングエリア|ハイウェイオアシス/.test(n);
}

/**
 * motorway_junction ノードの名前から施設種別を分類する。
 * スマートIC を最優先（「駿河湾沼津SAスマートIC」を sa に誤分類しないため）。
 */
export function classifyJunctionKind(name: string): HighwayKind {
  if (/スマート(IC|インター)|SIC(?![A-Za-z])/.test(name)) return 'ic';
  if (/JCT|ジャンクション/i.test(name)) return 'jct';
  if (/SA(?![A-Za-z])|サービスエリア/.test(name)) return 'sa';
  if (/PA(?![A-Za-z])|パーキングエリア/.test(name)) return 'pa';
  return 'ic';
}

/** SA/PA（highway=services|rest_area）の種別。名前を優先し、無ければタグで判定 */
export function classifyServiceKind(name: string, tag: 'services' | 'rest_area'): 'sa' | 'pa' {
  if (/SA(?![A-Za-z])|サービスエリア|ハイウェイオアシス/.test(name)) return 'sa';
  if (/PA(?![A-Za-z])|パーキングエリア/.test(name)) return 'pa';
  return tag === 'services' ? 'sa' : 'pa';
}

/** 都市高速（首都高・阪神・名古屋・福岡北九州・広島・東京高速道路 KK線）の way / 施設か */
export function isUrbanExpressway(tags: { operator?: string; name?: string }): boolean {
  if (
    tags.operator &&
    /首都高速|阪神高速|名古屋高速|福岡北九州高速|広島高速|東京高速道路/.test(tags.operator)
  ) {
    return true;
  }
  if (
    tags.name &&
    /^(首都高速?|阪神高速|名古屋高速|福岡高速|北九州高速|広島高速|東京高速道路)/.test(tags.name)
  ) {
    return true;
  }
  return false;
}

/**
 * 距離 km 以内で連結な点同士をまとめる単連結クラスタリング（union-find）。
 * 同名施設の上下線ノード・複数ランプを1ターゲットにマージするために使う。
 */
export function clusterByProximity<T extends { lat: number; lon: number }>(
  items: T[],
  km: number,
): T[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const d = haversineKm(
        { lat: items[i].lat, lng: items[i].lon },
        { lat: items[j].lat, lng: items[j].lon },
      );
      if (d <= km) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const g = groups.get(root);
    if (g) g.push(items[i]);
    else groups.set(root, [items[i]]);
  }
  return [...groups.values()];
}
