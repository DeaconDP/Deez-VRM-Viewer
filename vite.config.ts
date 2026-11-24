import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';

const STICKY_PORT = 5188;

export default defineConfig(({ mode }) => ({
  base: './',
  clearScreen: false,
  server: {
    host: '127.0.0.1',
    port: STICKY_PORT,
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  },
  preview: {
    host: '127.0.0.1',
    port: STICKY_PORT,
    strictPort: true
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than the app, so keep it in its own long-cached chunks.
        // three-vrm-animation is left out on purpose: it is imported on demand when a .vrma is opened.
        // three is split in two (scene graph/maths core vs WebGL renderer + loaders) to keep each chunk under 500 kB.
        manualChunks(id) {
          if (/[\\/]node_modules[\\/]three[\\/]build[\\/]three\.core\.js$/.test(id)) return 'three-core';
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/]@pixiv[\\/]three-vrm(-core|-materials-[a-z0-9-]+|-node-constraint|-springbone)?[\\/]/.test(id)) return 'three-vrm';
        }
      }
    }
  },
  plugins: [
    preact(),
    ...(mode === 'desktop' ? [] : [VitePWA({
      registerType: 'prompt',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Deez VRM Viewer',
        short_name: 'Deez VRM',
        description: 'A private, local-first VRM avatar inspector.',
        theme_color: '#121417',
        background_color: '#121417',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        file_handlers: [{ action: '.', accept: { 'model/gltf-binary': ['.vrm', '.glb'] } }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,glb,txt}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024
      }
    })])
  ]
}));
