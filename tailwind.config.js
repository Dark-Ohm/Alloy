/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0a0b10',
          800: '#0f111a',
          700: '#161822',
          600: '#1e2030',
          500: '#24283b',
          400: '#2f3347',
          300: '#3b3f5c',
        },
        accent: {
          blue: '#7aa2f7',
          cyan: '#7dcfff',
          green: '#9ece6a',
          red: '#f7768e',
          yellow: '#e0af68',
          purple: '#bb9af7',
          orange: '#ff9e64',
        },
        text: {
          primary: '#c0caf5',
          secondary: '#a9b1d6',
          muted: '#565f89',
          dim: '#3b4261',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      borderRadius: {
        xl: '1rem',
        '2xl': '1.25rem',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
