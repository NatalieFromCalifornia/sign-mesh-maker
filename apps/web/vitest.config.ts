import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    /*
     * jsdom rather than node: SVGLoader parses through DOMParser, and the
     * colour-parsing bug that shipped to users lived in that path. Testing the
     * parser without a DOM would have missed it entirely.
     */
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
