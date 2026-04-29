import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export const useTheme = () => {
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('nullchannel_theme');
    return saved === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    localStorage.setItem('nullchannel_theme', theme);
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  return { theme, toggleTheme: () => setTheme((v) => (v === 'dark' ? 'light' : 'dark')) };
};
