import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { FilterPanel } from '../components/quiz/FilterPanel';
import { QuizShell } from '../components/quiz/QuizShell';
import { TextQuizShell } from '../components/quiz/TextQuizShell';
import { saveSession } from '../lib/storage';
import { getQuiz } from '../quizzes';
import type { Question, QuizFilter } from '../quizzes/types';

type PageState =
  | { mode: 'setup' }
  | { mode: 'loading' }
  | { mode: 'error'; message: string }
  | { mode: 'playing'; questions: Question[]; filter: QuizFilter }
  | {
      mode: 'done';
      stats: { targetCount: number; hitCount: number; missCount: number; giveUpCount: number };
      filter: QuizFilter;
    };

export function QuizPage() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const quiz = getQuiz(quizId);
  const [state, setState] = useState<PageState>({ mode: 'setup' });

  if (!quiz) {
    return (
      <div className="page">
        <p>このクイズは準備中です。</p>
        <Link to="/">ホームへ戻る</Link>
      </div>
    );
  }

  const start = async (filter: QuizFilter) => {
    setState({ mode: 'loading' });
    try {
      const questions = await quiz.loadQuestions(filter);
      if (questions.length === 0) {
        setState({ mode: 'error', message: '条件に合う問題がありません。フィルタを変えてください。' });
        return;
      }
      setState({ mode: 'playing', questions, filter });
    } catch (err) {
      setState({ mode: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  switch (state.mode) {
    case 'setup':
      return (
        <div className="page">
          <FilterPanel meta={quiz.meta} onStart={start} />
        </div>
      );
    case 'loading':
      return <div className="page page-center">データを読み込み中…</div>;
    case 'error':
      return (
        <div className="page page-center">
          <p className="error-text">{state.message}</p>
          <button className="btn btn-primary" onClick={() => setState({ mode: 'setup' })}>
            設定に戻る
          </button>
        </div>
      );
    case 'playing':
      if (quiz.meta.answerMode === 'text') {
        return (
          <TextQuizShell
            questions={state.questions}
            quizTitle={quiz.meta.title}
            prefs={state.filter.prefs}
            onExit={() => setState({ mode: 'setup' })}
            onFinish={(stats) => {
              saveSession({
                quizId: quiz.meta.id,
                playedAt: new Date().toISOString(),
                questionCount: state.questions.length,
                ...stats,
              });
              setState({ mode: 'done', stats, filter: state.filter });
            }}
          />
        );
      }
      return (
        <QuizShell
          quizId={quiz.meta.id}
          questions={state.questions}
          radiusKm={state.filter.radiusKm}
          quizTitle={quiz.meta.title}
          prefs={state.filter.prefs}
          hoverKind={quiz.meta.hoverKind}
          hoverPrefs={state.filter.prefs}
          answerMode={quiz.meta.answerMode}
          selectionLabel={quiz.meta.selectionLabel}
          onExit={() => setState({ mode: 'setup' })}
          onFinish={(stats) => {
            saveSession({
              quizId: quiz.meta.id,
              playedAt: new Date().toISOString(),
              questionCount: state.questions.length,
              ...stats,
            });
            setState({ mode: 'done', stats, filter: state.filter });
          }}
        />
      );
    case 'done': {
      const { stats } = state;
      const accuracy =
        stats.targetCount > 0 ? Math.round((stats.hitCount / stats.targetCount) * 100) : 0;
      return (
        <div className="page page-center">
          <h2>結果</h2>
          <div className="result-card">
            <p className="result-accuracy">{accuracy}%</p>
            <p>
              正解 {stats.hitCount} / {stats.targetCount} 箇所
              {stats.missCount > 0 && ` ・ ミス ${stats.missCount} 回`}
              {stats.giveUpCount > 0 && ` ・ 降参 ${stats.giveUpCount} 箇所`}
            </p>
          </div>
          <div className="result-actions">
            <button className="btn btn-primary" onClick={() => start(state.filter)}>
              もう一度
            </button>
            <button className="btn btn-ghost" onClick={() => setState({ mode: 'setup' })}>
              設定を変える
            </button>
            <button className="btn btn-ghost" onClick={() => navigate('/')}>
              ホームへ
            </button>
          </div>
        </div>
      );
    }
  }
}
