/**
 * Tailwind 配置：按规格把主色/面板底色/边框色做成令牌；深色模式用 class 策略。
 * @type {import('tailwindcss').Config}
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#1677ff', hover: '#4096ff', active: '#0958d9', soft: '#e6f4ff' },
        panel: '#f7f8fa',
        line: '#e5e7eb',
        canvasbg: '#e8eaed',
      },
      fontFamily: {
        ui: ['-apple-system', 'BlinkMacSystemFont', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        doc: ['"宋体"', 'SimSun', '"Times New Roman"', 'serif'],
      },
      boxShadow: {
        paper: '0 2px 12px rgba(0,0,0,.15)',
        canvas: '0 2px 16px rgba(0,0,0,.18)',
      },
      fontSize: { '2xs': ['11px', '16px'] },
    },
  },
  plugins: [],
};
