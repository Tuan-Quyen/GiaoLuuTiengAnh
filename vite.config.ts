import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const target = `http://localhost:${process.env.API_PORT ?? 3001}`;

export default defineConfig({
  root: 'client',
  // HTTPS=1 npm run dev → https tự ký, cần cho micro khi mở từ điện thoại trong mạng LAN
  plugins: process.env.HTTPS ? [basicSsl()] : [],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': target,
      '/media': target,
      '/socket.io': { target, ws: true },
    },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1200 },
});
