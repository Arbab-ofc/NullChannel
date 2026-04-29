import { Navigate, Route, Routes } from 'react-router-dom';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import NotFoundPage from './pages/NotFoundPage';
import { useTheme } from './hooks/useTheme';

export default function App() {
  useTheme();

  return <Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/chat/:code" element={<ChatPage />} />
    <Route path="/404" element={<NotFoundPage />} />
    <Route path="*" element={<Navigate to="/404" replace />} />
  </Routes>;
}
