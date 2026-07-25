import path from "path"
import { fileURLToPath } from "url"
import vue from "@vitejs/plugin-vue"
import { defineConfig } from "vite"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [vue()],
  server: {
    port: Number(process.env.PORT) || 3000,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/resource': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
