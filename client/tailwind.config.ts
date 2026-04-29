import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#07070F',
        panel: '#121226',
        text: '#F4F3FF',
        muted: '#A7A9BE',
        accent: '#8B5CF6',
        cyan: '#3DD9EB',
        punch: '#FFE45E'
      },
      boxShadow: {
        panel: '8px 8px 0px #2B2F55',
        punch: '8px 8px 0px #FFE45E'
      }
    }
  },
  plugins: []
} satisfies Config;
