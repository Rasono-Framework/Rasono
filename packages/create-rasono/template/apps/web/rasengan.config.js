import { defineConfig } from 'rasengan';

export default defineConfig({
  vite: {
    resolve: {
      alias: { '@': '/src' },
    },
  },
});
