import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  envDir: path.resolve(__dirname, ".."),
  plugins: [react()],
  server: {
    port: 5173,
    allowedHosts: ['remember-flier-feminine.ngrok-free.dev'],
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
