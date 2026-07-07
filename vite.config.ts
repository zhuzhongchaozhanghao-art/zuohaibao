import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    proxy: {
      '/v1': {
        target: 'https://api.ark717.com',
        changeOrigin: true,
      },
    },
  },
})
