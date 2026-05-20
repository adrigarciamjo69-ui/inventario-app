import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // React core
          'vendor-react': ['react', 'react-dom'],
          // PDF generation (jsPDF es el más pesado ~300KB)
          'vendor-pdf': ['jspdf', 'jspdf-autotable'],
          // Excel export
          'vendor-xlsx': ['xlsx'],
          // Iconos
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
