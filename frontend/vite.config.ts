/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // ページのコードと分けて、更新頻度の低いライブラリをブラウザにキャッシュさせる
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/,
            },
            {
              name: 'mui-vendor',
              test: /[\\/]node_modules[\\/](@mui|@emotion)[\\/]/,
            },
          ],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // テストは実行環境の .env に左右されないよう、各テストで明示的に設定する
    env: { VITE_API_BASE_URL: '' },
  },
})
