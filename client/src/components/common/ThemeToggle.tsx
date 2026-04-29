import { Sun, Moon } from 'lucide-react';
import { Button } from './Button';
import { useTheme } from '../../hooks/useTheme';

export const ThemeToggle = () => {
  const { theme, toggleTheme } = useTheme();

  return (
    <Button onClick={toggleTheme} aria-label="Toggle theme">
      {theme === 'dark' ? <Sun className="mr-2 inline h-4 w-4" /> : <Moon className="mr-2 inline h-4 w-4" />}
      {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
    </Button>
  );
};
