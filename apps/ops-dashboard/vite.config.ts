import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const devApiBaseUrl = process.env.VITE_OPS_API_BASE_URL?.trim() || "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/v1": {
        target: devApiBaseUrl,
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true,
    clearMocks: true,
  },
});
