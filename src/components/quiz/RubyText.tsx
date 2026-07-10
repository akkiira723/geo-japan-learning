import { Fragment } from 'react';
import type { Ruby } from '../../quizzes/types';

/**
 * テキスト中の地名部分にふりがな（ルビ）を振って描画する。
 * 各 Ruby の b をテキスト先頭から順に検索し、最初に見つかった箇所に <ruby> を当てる。
 * 見つからない・rubies が無い場合はプレーンテキストにフォールバックする。
 */
export function RubyText({ text, rubies }: { text: string; rubies?: Ruby[] }) {
  if (!rubies || rubies.length === 0) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const r of rubies) {
    if (!r?.b || !r.k) continue;
    const i = text.indexOf(r.b, cursor);
    if (i === -1) continue;
    if (i > cursor) parts.push(text.slice(cursor, i));
    parts.push(
      <ruby key={`${i}-${r.b}`}>
        {r.b}
        <rt>{r.k}</rt>
      </ruby>,
    );
    cursor = i + r.b.length;
  }
  if (parts.length === 0) return <>{text}</>;
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts.map((p, i) => <Fragment key={i}>{p}</Fragment>)}</>;
}
