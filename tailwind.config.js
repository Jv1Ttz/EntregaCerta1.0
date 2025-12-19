/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./**/*.{js,ts,jsx,tsx}", // Isso pega tudo (App.tsx, components, services, etc)
    "!./node_modules/**"       // Isso ignora a pasta pesada do sistema
  ],
  darkMode: 'class', // Importante: mantivemos o modo manual
  theme: {
    extend: {},
  },
  plugins: [],
}