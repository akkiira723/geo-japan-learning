import { Link } from 'react-router-dom';

const ENTRIES: { date: string; items: string[] }[] = [
  {
    date: '2026-07-10',
    items: [
      '高速道路クイズを追加（IC・JCT・SA/PA、都市高速の出入口も収録。施設種別と道路タイプで絞り込み可能）',
    ],
  },
  {
    date: '2026-07-07',
    items: [
      'マンホール単語帳を追加（写真をめくって自治体名を暗記、「覚えた」チェックで未習得のみに絞り込み）',
      '市外局番クイズ: 郡全体が複数の局番に割り当てられていた地域の区画を修正',
    ],
  },
  {
    date: '2026-07-06',
    items: [
      'マンホールクイズを追加（全国 1,582 市区町村・4,297 枚の画像）',
      '出題数の選択肢に「全問」モードを追加',
      '1問あたりのミスを5回までに制限し、答え合わせ時にマンホールの説明を表示',
      'ポリゴンクイズでカーソル下の地域をハイライト表示',
      '各問題の開始時に、選択中の都道府県へ地図をフィット',
      'マンホール写真を最初から拡大表示',
    ],
  },
  {
    date: '2026-07-05',
    items: [
      '初版公開: 駅名クイズ・市外局番クイズ・旧市町村クイズ',
      '地図タイプ切り替え（OSMFJ 日本語スタイル / 地理院タイル / CARTO）と都道府県・市区町村境界オーバーレイを追加',
      'ポリゴン問題のミス距離を最寄りの境界線までの距離で計測するよう改善',
    ],
  },
];

export function Changelog() {
  return (
    <div className="page changelog">
      <h1>変更履歴</h1>
      {ENTRIES.map((entry) => (
        <section key={entry.date}>
          <h2>{entry.date}</h2>
          <ul>
            {entry.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
      <Link to="/">ホームへ戻る</Link>
    </div>
  );
}
