import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Footer } from './components/common/Footer';
import LandingPage from './pages/LandingPage';
import ChatPage from './pages/ChatPage';
import NotFoundPage from './pages/NotFoundPage';

export default function App() {
  const location = useLocation();
  return <><Routes>
    <Route path="/" element={<LandingPage />} />
    <Route path="/chat/:code" element={<ChatPage />} />
    <Route path="/404" element={<NotFoundPage />} />
    <Route path="*" element={<Navigate to="/404" replace />} />
  </Routes>{!location.pathname.startsWith('/chat/') && <Footer />}</>;
}
