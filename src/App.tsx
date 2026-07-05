import { HashRouter, Route, Routes } from 'react-router-dom';
import { About } from './pages/About';
import { Home } from './pages/Home';
import { QuizPage } from './pages/QuizPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/quiz/:quizId" element={<QuizPage />} />
      </Routes>
    </HashRouter>
  );
}
