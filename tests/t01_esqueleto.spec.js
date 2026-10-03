// T-01 · Esqueleto PWA: carga, pestañas, fuentes locales, instalabilidad y apertura sin señal.
import { test, expect } from '@playwright/test';

test('carga a 375×812 sin desbordes y con las 4 pestañas', async ({ page }) => {
  await page.goto('index.html');
  await expect(page.locator('#titulo-vista')).toHaveText('Hola');
  await expect(page.locator('#version-app')).toHaveText(/^v\d+/, { useInnerText: false });
  const anchoDoc = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(anchoDoc).toBeLessThanOrEqual(375);

  for (const [pestana, titulo] of [['visitas', 'Visitas a parques'], ['historial', 'Historial'], ['perfil', 'Perfil'], ['inicio', 'Hola']]) {
    await page.locator(`[data-pestana="${pestana}"]`).click();
    await expect(page.locator('#titulo-vista')).toHaveText(titulo);
    await expect(page.locator(`#vista-${pestana}`)).toBeVisible();
    await expect(page.locator(`[data-pestana="${pestana}"]`)).toHaveAttribute('aria-current', 'page');
  }
});

test('áreas táctiles ≥ 44 px y texto ≥ 13 px', async ({ page }) => {
  await page.goto('index.html');
  const pequenos = await page.evaluate(() => {
    const malos = [];
    for (const el of document.querySelectorAll('button, a, input')) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.height < 44 || r.width < 44)) malos.push(el.id || el.textContent.trim());
    }
    for (const el of document.querySelectorAll('body *')) {
      if (!el.offsetParent || !el.childNodes.length) continue;
      const tieneTexto = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      if (tieneTexto && parseFloat(getComputedStyle(el).fontSize) < 13) malos.push(`texto: ${el.textContent.trim()}`);
    }
    return malos;
  });
  expect(pequenos).toEqual([]);
});

test('fuentes IBM Plex se cargan desde /fonts', async ({ page }) => {
  await page.goto('index.html');
  await page.evaluate(() => document.fonts.ready);
  const ok = await page.evaluate(async () => {
    await document.fonts.load('600 16px "IBM Plex Sans"');
    await document.fonts.load('400 16px "IBM Plex Mono"');
    return document.fonts.check('600 16px "IBM Plex Sans"') && document.fonts.check('400 16px "IBM Plex Mono"');
  });
  expect(ok).toBe(true);
});

test('es instalable (sin errores de instalabilidad de Chrome)', async ({ page }) => {
  await page.goto('index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const { errors } = await cdp.send('Page.getAppManifest');
  expect(errors).toEqual([]);
});

test('abre sin señal después de la primera visita', async ({ page, context }) => {
  await page.goto('index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();   // ya controlada por el service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#titulo-vista')).toHaveText('Hola');
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#version-app')).toHaveText(/^v\d+/);
  const fuentes = await page.evaluate(async () => {
    await document.fonts.load('600 16px "IBM Plex Sans"');
    return document.fonts.check('600 16px "IBM Plex Sans"');
  });
  expect(fuentes).toBe(true);
  await context.setOffline(false);
});

test('el cascarón precargado incluye todo lo que pide index.html', async ({ page }) => {
  await page.goto('index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  const faltantes = await page.evaluate(async () => {
    const nombres = await caches.keys();
    const cache = await caches.open(nombres.find((n) => n.startsWith('asis-')));
    const pedidos = performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin));
    const out = [];
    for (const u of pedidos) if (!(await cache.match(u, { ignoreSearch: true })) && !u.endsWith('sw.js')) out.push(u);
    return out;
  });
  expect(faltantes).toEqual([]);
});
