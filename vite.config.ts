import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'frontend', // This points Vite to the frontend folder where index.html should be
  publicDir: 'public', // This should be relative to the root, pointing to the public folder inside frontend
  build: {
    outDir: '../dist', // Output directory for build files, relative to the root
  },
});
