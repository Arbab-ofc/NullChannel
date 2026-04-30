import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg) / <alpha-value>)',
        panel: 'hsl(var(--panel) / <alpha-value>)',
        text: 'hsl(var(--text) / <alpha-value>)',
        muted: 'hsl(var(--muted) / <alpha-value>)',
        accent: 'hsl(var(--accent) / <alpha-value>)',
        cyan: 'hsl(var(--cyan) / <alpha-value>)',
        punch: 'hsl(var(--punch) / <alpha-value>)'
      },
      boxShadow: {
        panel: '4px 4px 0px hsl(var(--shadow-offset))',
        punch: '5px 5px 0px hsl(var(--punch))'
      }
    }
  },
  plugins: []
} satisfies Config;
