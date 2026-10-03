// Pruebas end-to-end en Chromium a 375×812 (tamaño de celular), con cámara falsa.
import { defineConfig } from '@playwright/test';

// Permite que context.route atienda también las peticiones del service worker (prueba de Background Sync).
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4173/',
    viewport: { width: 375, height: 812 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: 'es-MX',
    timezoneId: 'America/Mazatlan',
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']
    }
  },
  webServer: {
    command: 'node tests/servidor.mjs',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: true
  }
});
