import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import { ThemeProvider } from './hooks/useTheme';
import { ensureSession } from './lib/session';

const root = ReactDOM.createRoot(document.getElementById('root')!);
const start = async () => {
  try {
    await ensureSession();
    root.render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>

    );
    window.setInterval(() => { void ensureSession().catch(() => undefined); }, 10 * 60 * 1000);
  } catch {
    root.render(<main className="p-8"><p>Unable to initialize your anonymous session.</p><button onClick={() => void start()}>Retry</button></main>);
  }
};
void start();
