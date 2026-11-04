import { HashRouter, Route, Routes } from 'react-router-dom';
import { About } from './pages/About';
import { Changelog } from './pages/Changelog';
import { EmblemCards } from './pages/EmblemCards';
import { Home } from './pages/Home';
import { ManholeCards } from './pages/ManholeCards';
import { QuizPage } from './pages/QuizPage';

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/changelog" element={<Changelog />} />
        <Route path="/quiz/:quizId" element={<QuizPage />} />
        <Route path="/cards/manhole" element={<ManholeCards />} />
        <Route path="/cards/emblem" element={<EmblemCards />} />
      </Routes>
    </HashRouter>
  );
}
