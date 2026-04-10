// vite.config.ts
import { defineConfig } from "file:///sessions/cool-festive-franklin/mnt/Browser%20Tab%20Manager%20Project/node_modules/vite/dist/node/index.js";
import react from "file:///sessions/cool-festive-franklin/mnt/Browser%20Tab%20Manager%20Project/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/sessions/cool-festive-franklin/mnt/Browser Tab Manager Project/packages/chrome-extension";
var vite_config_default = defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        popup: path.resolve(__vite_injected_original_dirname, "public/popup.html"),
        sidebar: path.resolve(__vite_injected_original_dirname, "public/sidebar.html")
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: "[name]-[hash][extname]"
      }
    }
  },
  resolve: {
    alias: {
      "@tabflow/core": path.resolve(__vite_injected_original_dirname, "../core/src")
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvY29vbC1mZXN0aXZlLWZyYW5rbGluL21udC9Ccm93c2VyIFRhYiBNYW5hZ2VyIFByb2plY3QvcGFja2FnZXMvY2hyb21lLWV4dGVuc2lvblwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL3Nlc3Npb25zL2Nvb2wtZmVzdGl2ZS1mcmFua2xpbi9tbnQvQnJvd3NlciBUYWIgTWFuYWdlciBQcm9qZWN0L3BhY2thZ2VzL2Nocm9tZS1leHRlbnNpb24vdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL3Nlc3Npb25zL2Nvb2wtZmVzdGl2ZS1mcmFua2xpbi9tbnQvQnJvd3NlciUyMFRhYiUyME1hbmFnZXIlMjBQcm9qZWN0L3BhY2thZ2VzL2Nocm9tZS1leHRlbnNpb24vdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCByZWFjdCBmcm9tICdAdml0ZWpzL3BsdWdpbi1yZWFjdCc7XG5pbXBvcnQgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgcGx1Z2luczogW3JlYWN0KCldLFxuICBidWlsZDoge1xuICAgIG91dERpcjogJ2Rpc3QnLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIGlucHV0OiB7XG4gICAgICAgIHBvcHVwOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAncHVibGljL3BvcHVwLmh0bWwnKSxcbiAgICAgICAgc2lkZWJhcjogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJ3B1YmxpYy9zaWRlYmFyLmh0bWwnKSxcbiAgICAgIH0sXG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdbbmFtZV0uanMnLFxuICAgICAgICBjaHVua0ZpbGVOYW1lczogJ1tuYW1lXS1baGFzaF0uanMnLFxuICAgICAgICBhc3NldEZpbGVOYW1lczogJ1tuYW1lXS1baGFzaF1bZXh0bmFtZV0nLFxuICAgICAgfSxcbiAgICB9LFxuICB9LFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdAdGFiZmxvdy9jb3JlJzogcGF0aC5yZXNvbHZlKF9fZGlybmFtZSwgJy4uL2NvcmUvc3JjJyksXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFtYyxTQUFTLG9CQUFvQjtBQUNoZSxPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBSXpDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixlQUFlO0FBQUEsTUFDYixPQUFPO0FBQUEsUUFDTCxPQUFPLEtBQUssUUFBUSxrQ0FBVyxtQkFBbUI7QUFBQSxRQUNsRCxTQUFTLEtBQUssUUFBUSxrQ0FBVyxxQkFBcUI7QUFBQSxNQUN4RDtBQUFBLE1BQ0EsUUFBUTtBQUFBLFFBQ04sZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsUUFDaEIsZ0JBQWdCO0FBQUEsTUFDbEI7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBQ0EsU0FBUztBQUFBLElBQ1AsT0FBTztBQUFBLE1BQ0wsaUJBQWlCLEtBQUssUUFBUSxrQ0FBVyxhQUFhO0FBQUEsSUFDeEQ7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
