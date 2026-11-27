import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  server: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
  preview: {
    port: 3000,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 3000,
  },
  worker: {
    format: 'es',
  },
  plugins: [
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'public/*'],
      manifest: {
        name: 'VortexMD: A Client-Side, Out-of-Core Explorer for GROMACS Trajectories',
        short_name: 'VortexMD',
        description: 'A Client-Side, Out-of-Core Explorer for GROMACS Trajectories',
        theme_color: '#2563eb',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'any',
        icons: [
          {
            src: 'favicon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,wasm}', 'demo/demo.pdb'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallbackDenylist: [/^\/.*\.(xtc|gro|pdb|cif)$/i],
        runtimeCaching: [
          {
            // Allow bundled demo topology to be cached for offline demonstration
            urlPattern: /.*demo\/demo\.pdb$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'vortexmd-demo-assets',
              expiration: {
                maxEntries: 5,
                maxAgeSeconds: 30 * 24 * 60 * 60
              }
            }
          },
          {
            // Large dynamic scientific trajectories route directly to network/workers
            urlPattern: /\.(?:xtc|gro|pdb|cif)$/i,
            handler: 'NetworkOnly'
          }
        ]
      }
    })
  ]
});
