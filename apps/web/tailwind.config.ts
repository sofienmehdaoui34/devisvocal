import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1a56db', dark: '#1e429f', light: '#e8f0fe' },
      },
    },
  },
  plugins: [],
};

export default config;
