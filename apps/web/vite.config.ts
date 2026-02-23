import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const devApiBaseUrl = process.env.VITE_DEV_API_BASE_URL?.trim() || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  server: {
    port: 5173,
    proxy: {
      "/v1": {
        target: devApiBaseUrl,
        changeOrigin: true,
      },
      "/health": {
        target: devApiBaseUrl,
        changeOrigin: true,
      },
    },
  },
});
