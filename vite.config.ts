import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Transpile nullish coalescing (??) and optional chaining (?.) down to ES2018
    // so older Android WebViews, iOS 13, and automated crawlers never throw 'SyntaxError: Unexpected token ?'
    target: 'es2018',
    rollupOptions: {
      output: {
        // Split React into its own chunk so it initializes FIRST,
        // preventing the "Cannot access 'X' before initialization" TDZ crash
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/scheduler')) {
            return 'react-vendor';
          }
          if (id.includes('node_modules/jspdf') || id.includes('node_modules/html2canvas')) {
            return 'pdf-vendor';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
        // Prevent Rollup from reordering hoisted imports, which causes TDZ
        hoistTransitiveImports: false,
      },
    },
  },
});
