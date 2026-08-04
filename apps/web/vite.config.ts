import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        /*
         * Split the two large dependencies into their own chunks.
         *
         * They change far less often than the app does, so a deploy that
         * touches only application code leaves both cached. It also lets the
         * router load them separately: signing in or browsing projects has no
         * use for a 3D engine.
         */
        manualChunks: {
          three: ['three'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
    // Raised deliberately: three is genuinely this large and the warning at
    // 500kB has nothing left to tell us once the chunks are separated.
    chunkSizeWarningLimit: 800,
  },
  server: {
    port: 5173,
    watch: {
      /*
       * The repo lives on /mnt/f, a Windows drive mounted into WSL. inotify
       * doesn't fire across that boundary, so without polling the dev server
       * silently serves stale modules — edits appear to do nothing until you
       * restart it. Polling costs some CPU; a dev server that ignores your
       * changes costs more.
       */
      usePolling: true,
      interval: 300,
    },
  },
});
