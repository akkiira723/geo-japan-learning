import { describe, expect, it } from 'vitest';
import {
  canonicalUrbanGateName,
  classifyJunctionKind,
  classifyServiceKind,
  clusterByProximity,
  facilityCore,
  facilityKanaCore,
  isExcludedName,
  isExpresswayRestArea,
  isUrbanExpressway,
  normalizeFacilityName,
  stripDirection,
} from './highway.ts';

describe('stripDirection', () => {
  it('括弧つき方向サフィックスを除去する', () => {
    expect(stripDirection('海老名SA（下り）')).toBe('海老名SA');
    expect(stripDirection('海老名SA(上り)')).toBe('海老名SA');
    expect(stripDirection('大黒PA 上下線')).toBe('大黒PA');
  });
  it('裸の方向サフィックスを除去する', () => {
    expect(stripDirection('加平出入口 外回り')).toBe('加平出入口');
    expect(stripDirection('平和島PA上り')).toBe('平和島PA');
    expect(stripDirection('市川PA 東京方面')).toBe('市川PA');
  });
  it('固有名の一部は除去しない', () => {
    expect(stripDirection('登坂PA')).toBe('登坂PA');
    expect(stripDirection('上里SA')).toBe('上里SA');
    expect(stripDirection('下りト沢IC')).toBe('下りト沢IC');
  });
});

describe('normalizeFacilityName', () => {
  it('入口/出口を出入口に正規化して同一施設に名寄せする', () => {
    expect(normalizeFacilityName('霞が関入口')).toBe('霞が関出入口');
    expect(normalizeFacilityName('霞が関出口')).toBe('霞が関出入口');
    expect(normalizeFacilityName('霞が関出入口')).toBe('霞が関出入口');
  });
  it('方向サフィックスと組み合わせて正規化する', () => {
    expect(normalizeFacilityName('板橋本町出口（内回り）')).toBe('板橋本町出入口');
  });
  it('入口/出口で終わらない名前は変更しない', () => {
    expect(normalizeFacilityName('海老名SA（下り）')).toBe('海老名SA');
    expect(normalizeFacilityName('豊田JCT')).toBe('豊田JCT');
  });
  it('全角英字を半角に正規化する（分類の前提）', () => {
    expect(normalizeFacilityName('豊川ＩＣ')).toBe('豊川IC');
    expect(normalizeFacilityName('赤塚ＰＡ（上り）')).toBe('赤塚PA');
    expect(classifyJunctionKind(normalizeFacilityName('三ケ日ＪＣＴ'))).toBe('jct');
  });
});

describe('canonicalUrbanGateName', () => {
  it('サフィックスの無い都市高速の裸名称に出入口を付ける', () => {
    expect(canonicalUrbanGateName('霞が関')).toBe('霞が関出入口');
    expect(canonicalUrbanGateName('台場')).toBe('台場出入口');
  });
  it('既にサフィックスがある名前はそのまま', () => {
    expect(canonicalUrbanGateName('霞が関出入口')).toBe('霞が関出入口');
    expect(canonicalUrbanGateName('用賀IC')).toBe('用賀IC');
    expect(canonicalUrbanGateName('仁保ランプ')).toBe('仁保ランプ');
  });
});

describe('isExpresswayRestArea', () => {
  it('SA/PA 系名称だけを採用する', () => {
    expect(isExpresswayRestArea('海老名SA')).toBe(true);
    expect(isExpresswayRestArea('赤塚ＰＡ（上り）')).toBe(true);
    expect(isExpresswayRestArea('刈谷ハイウェイオアシス')).toBe(true);
    expect(isExpresswayRestArea('道の駅うずしお')).toBe(false);
    expect(isExpresswayRestArea('コインパーキング')).toBe(false);
    expect(isExpresswayRestArea('世田谷公園駐車場')).toBe(false);
  });
});

describe('isExcludedName', () => {
  it('料金所・検札所・バスストップを除外する', () => {
    expect(isExcludedName('東京本線料金所')).toBe(true);
    expect(isExcludedName('米沢検札所')).toBe(true);
    expect(isExcludedName('江田BS')).toBe(true);
    expect(isExcludedName('中筋バスストップ')).toBe(true);
  });
  it('固有名が残らないものを除外する', () => {
    expect(isExcludedName('出口')).toBe(true);
    expect(isExcludedName('入口（下り）')).toBe(true);
  });
  it('通常の施設は除外しない', () => {
    expect(isExcludedName('海老名SA')).toBe(false);
    expect(isExcludedName('用賀IC')).toBe(false);
    expect(isExcludedName('霞が関入口')).toBe(false);
  });
});

describe('classifyJunctionKind', () => {
  it('スマートIC を最優先で ic に分類する', () => {
    expect(classifyJunctionKind('駿河湾沼津SAスマートIC')).toBe('ic');
    expect(classifyJunctionKind('三芳PAスマートIC')).toBe('ic');
  });
  it('JCT / SA / PA / IC を分類する', () => {
    expect(classifyJunctionKind('豊田JCT')).toBe('jct');
    expect(classifyJunctionKind('小牧ジャンクション')).toBe('jct');
    expect(classifyJunctionKind('海老名SA')).toBe('sa');
    expect(classifyJunctionKind('大黒パーキングエリア')).toBe('pa');
    expect(classifyJunctionKind('用賀IC')).toBe('ic');
    expect(classifyJunctionKind('霞が関出入口')).toBe('ic');
  });
});

describe('classifyServiceKind', () => {
  it('名前を優先する', () => {
    expect(classifyServiceKind('大黒PA', 'services')).toBe('pa');
    expect(classifyServiceKind('海老名サービスエリア', 'rest_area')).toBe('sa');
  });
  it('名前で判別できなければタグで判定する', () => {
    expect(classifyServiceKind('刈谷ハイウェイオアシス', 'services')).toBe('sa');
    expect(classifyServiceKind('道の駅風の里', 'rest_area')).toBe('pa');
  });
});

describe('isUrbanExpressway', () => {
  it('operator で判定する', () => {
    expect(isUrbanExpressway({ operator: '首都高速道路株式会社' })).toBe(true);
    expect(isUrbanExpressway({ operator: '阪神高速道路株式会社' })).toBe(true);
    expect(isUrbanExpressway({ operator: '福岡北九州高速道路公社' })).toBe(true);
    expect(isUrbanExpressway({ operator: '中日本高速道路株式会社' })).toBe(false);
  });
  it('name でフォールバック判定する', () => {
    expect(isUrbanExpressway({ name: '首都高速中央環状線' })).toBe(true);
    expect(isUrbanExpressway({ name: '名古屋高速1号楠線' })).toBe(true);
    expect(isUrbanExpressway({ name: '東名高速道路' })).toBe(false);
    expect(isUrbanExpressway({})).toBe(false);
  });
});

describe('clusterByProximity', () => {
  // 緯度 0.01 度 ≒ 1.11km
  it('閾値内の点を1クラスタにまとめる', () => {
    const items = [
      { lat: 35.0, lon: 139.0 },
      { lat: 35.01, lon: 139.0 },
      { lat: 35.005, lon: 139.005 },
    ];
    expect(clusterByProximity(items, 2)).toHaveLength(1);
  });
  it('閾値超の同名は別クラスタのまま残す', () => {
    const items = [
      { lat: 35.0, lon: 139.0 },
      { lat: 35.1, lon: 139.0 }, // 約11km
    ];
    expect(clusterByProximity(items, 2)).toHaveLength(2);
  });
  it('推移的に連結する（A-B 1.1km, B-C 1.1km, A-C 2.2km でも1クラスタ）', () => {
    const items = [
      { lat: 35.0, lon: 139.0 },
      { lat: 35.01, lon: 139.0 },
      { lat: 35.02, lon: 139.0 },
    ];
    expect(clusterByProximity(items, 1.5)).toHaveLength(1);
  });
});

describe('facilityCore / facilityKanaCore', () => {
  it('種別サフィックスを繰り返し外して地名コアを得る', () => {
    expect(facilityCore('海老名SA')).toBe('海老名');
    expect(facilityCore('浜崎橋JCT')).toBe('浜崎橋');
    expect(facilityCore('台場出入口')).toBe('台場');
    expect(facilityCore('海津PAスマートインターチェンジ')).toBe('海津');
    expect(facilityCore('商工センター西ランプ')).toBe('商工センター西');
  });
  it('裸名称・サフィックスのみの名前はそのまま', () => {
    expect(facilityCore('川口東')).toBe('川口東');
    expect(facilityCore('出入口')).toBe('出入口');
  });
  it('読みのサフィックスも同様に外す', () => {
    expect(facilityKanaCore('えびなさーびすえりあ')).toBe('えびな');
    expect(facilityKanaCore('だいばでいりぐち')).toBe('だいば');
    expect(facilityKanaCore('かいづぱーきんぐえりあすまーと')).toBe('かいづ');
    expect(facilityKanaCore('かわぐちひがし')).toBe('かわぐちひがし');
  });
});
