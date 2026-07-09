/**
 * 自治体名の表記ゆれ正規化。
 * 比較の両側に同じ正規化を適用する前提（表示用ではない）。
 */
export function normalizeName(s: string): string {
  return s
    .replace(/\s+/g, '')
    .replace(/ヶ/g, 'ケ')
    .replace(/龍/g, '竜')
    .replace(/檜/g, '桧')
    .replace(/檮/g, '梼')
    .replace(/藪/g, '薮')
    .replace(/嶋/g, '島')
    .replace(/舘/g, '館')
    .replace(/竈/g, '釜')
    .replace(/竃/g, '釜')
    .replace(/澤/g, '沢')
    .replace(/團/g, '団')
    .replace(/籠/g, '篭')
    .replace(/曾/g, '曽');
}
