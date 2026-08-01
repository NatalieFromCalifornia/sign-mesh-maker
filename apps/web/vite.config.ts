import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
