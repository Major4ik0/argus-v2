import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// В разработке API — отдельный процесс uvicorn на :8000; в Docker фронтенд отдаёт сам FastAPI.
// KAFEDRA_BASE=/kafedra/ — сборка для АРГУСа: приложение открывается по адресу /kafedra/ того же сервера.
export default defineConfig({
  base: process.env.KAFEDRA_BASE || "/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:8000" },
  },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 2000 },
});
