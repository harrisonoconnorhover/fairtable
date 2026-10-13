import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: process.env.FAIRTABLE_SERVER
      ? { "/api": process.env.FAIRTABLE_SERVER }
      : undefined,
  },
  build: { target: "es2022", chunkSizeWarningLimit: 800 },
});
