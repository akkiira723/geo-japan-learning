import { Link } from 'react-router-dom';
import { QUIZZES } from '../quizzes';
import { loadSessions } from '../lib/storage';

const QUIZ_ICONS: Record<string, string> = {
  station: '🚉',
  highway: '🛣️',
  route: '🍙',
  areacode: '☎️',
  legacy: '🗾',
  legacyname: '📝',
  manhole: '🕳️',
};

const PLANNED: { id: string; title: string; description: string }[] = [
  { id: 'areacode', title: '市外局番クイズ', description: '市外局番からエリアを当てる（準備中）' },
  { id: 'legacy', title: '旧市町村クイズ', description: '平成の大合併で消えた市町村名から場所を当てる（準備中）' },
];

export function Home() {
  const sessions = loadSessions();
  const quizzes = Object.values(QUIZZES);
  const availableIds = new Set(quizzes.map((q) => q.meta.id as string));

  return (
    <div className="page home">
      <h1>Geo Japan Learning</h1>
      <p className="home-lead">GeoGuessr 日本マップ対策の地図クイズ。地図をクリックしてピンを置き、Space キーで回答。</p>

      <div className="quiz-cards">
        {quizzes.map((q) => (
          <Link key={q.meta.id} to={`/quiz/${q.meta.id}`} className="quiz-card">
            <span className="quiz-card-icon" aria-hidden="true">
              {QUIZ_ICONS[q.meta.id] ?? '🧭'}
            </span>
            <h2>{q.meta.title}</h2>
            <p>{q.meta.description}</p>
          </Link>
        ))}
        <Link to="/cards/manhole" className="quiz-card">
          <span className="quiz-card-icon" aria-hidden="true">
            🃏
          </span>
          <h2>マンホール単語帳</h2>
          <p>デザイン蓋を1枚ずつめくって自治体名を暗記。覚えた蓋はチェックして絞り込み。</p>
        </Link>
        {PLANNED.filter((p) => !availableIds.has(p.id)).map((p) => (
          <div key={p.id} className="quiz-card quiz-card-disabled">
            <span className="quiz-card-icon" aria-hidden="true">
              {QUIZ_ICONS[p.id] ?? '🧭'}
            </span>
            <h2>{p.title}</h2>
            <p>{p.description}</p>
          </div>
        ))}
      </div>

      {sessions.length > 0 && (
        <section className="home-history">
          <h2>最近のプレイ</h2>
          <ul>
            {sessions.slice(0, 5).map((s, i) => (
              <li key={i}>
                {new Date(s.playedAt).toLocaleString('ja-JP')} — {s.quizId}: 正解 {s.hitCount}/
                {s.targetCount}
              </li>
            ))}
          </ul>
        </section>
      )}

      <footer className="home-footer">
        <Link to="/about">データ出典・このツールについて</Link>
        <br />
        <Link to="/changelog">変更履歴</Link>
      </footer>
    </div>
  );
}
