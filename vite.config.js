import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// BASE_PATH chỉ cần khi host ở GitHub Pages (vd "/kytich-team-dashboard/").
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
})
