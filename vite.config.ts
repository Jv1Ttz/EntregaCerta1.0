import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    server: {
      port: 3000,
      host: '0.0.0.0',
    },
    plugins: [react()],
    
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },

    resolve: {
      alias: {
        '@': path.resolve(process.cwd(), '.'),
        
        // 👇 A CURA DO ERRO CATATÔNICO 👇
        // Isso diz ao Vite: "Sempre que alguém pedir 'react-map-gl',
        // entregue 'react-map-gl/mapbox' silenciosamente."
        'react-map-gl': 'react-map-gl/mapbox',
      },
    },

    optimizeDeps: {
      // 👇 Removemos 'react-map-gl' daqui (pois ele não tem entrada padrão)
      // Mantemos mapbox-gl para garantir performance
      include: ['mapbox-gl'],
    },
  };
});