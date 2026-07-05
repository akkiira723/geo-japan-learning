export interface Region {
  id: string;
  label: string;
  prefs: number[];
}

export const REGIONS: Region[] = [
  { id: 'hokkaido', label: '北海道', prefs: [1] },
  { id: 'tohoku', label: '東北', prefs: [2, 3, 4, 5, 6, 7] },
  { id: 'kanto', label: '関東', prefs: [8, 9, 10, 11, 12, 13, 14] },
  { id: 'chubu', label: '中部', prefs: [15, 16, 17, 18, 19, 20, 21, 22, 23] },
  { id: 'kinki', label: '近畿', prefs: [24, 25, 26, 27, 28, 29, 30] },
  { id: 'chugoku', label: '中国', prefs: [31, 32, 33, 34, 35] },
  { id: 'shikoku', label: '四国', prefs: [36, 37, 38, 39] },
  { id: 'kyushu', label: '九州・沖縄', prefs: [40, 41, 42, 43, 44, 45, 46, 47] },
];
