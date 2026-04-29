import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#05050A',
        panel: '#0D0B18',
        text: '#EDE9FE',
        muted: '#9CA3AF',
        accent: '#7C3AED',
        cyan: '#22D3EE'
      },
      boxShadow: {
        panel: '6px 6px 0px rgba(34,211,238,0.14)'
      }
    }
  },
  plugins: []
} satisfies Config;
