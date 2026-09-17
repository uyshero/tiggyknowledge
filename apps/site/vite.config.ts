import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  base: process.env.SITE_BASE ?? '/',
  server: {
    host: '127.0.0.1',
    port: 4321,
  },
  preview: {
    host: '127.0.0.1',
    port: 4322,
  },
})
