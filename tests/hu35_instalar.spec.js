// HU-35 · Instalación: guía de una página con código QR (instalar.html) que se puede imprimir; el QR se lee y apunta a la
// app; "Instalar en este teléfono" en Perfil cuando el navegador lo ofrece (Android). Datos ficticios.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, USUARIOS } from './simulador.js';

// Lee el QR que dibuja la página con jsQR (solo para pruebas; nunca llega al teléfono)
async function leerQR(page) {
  await page.addScriptTag({ path: 'node_modules/jsqr/dist/jsQR.js' });
  return page.evaluate(async () => {
    const svg = document.querySelector('#guia-codigo svg').outerHTML;
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    const lienzo = document.createElement('canvas');
    lienzo.width = lienzo.height = 400;
    const ctx = lienzo.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, 400, 400);
    const datos = ctx.getImageData(0, 0, 400, 400);
    return window.jsQR(datos.data, 400, 400)?.data ?? null;
  });
}

test('la guía muestra un QR legible con la dirección de la app y el nombre de la organización', async ({ page }) => {
  await page.goto('instalar.html?org=Parques%20Alegres%20IAP');
  await expect(page.locator('#guia-codigo svg')).toBeVisible();
  const esperada = new URL('./', page.url()).href;
  await expect(page.locator('#guia-url')).toHaveText(esperada);
  expect(await leerQR(page)).toBe(esperada);
  await expect(page.locator('#guia-org')).toHaveText('Parques Alegres IAP · Registro electrónico de jornada');
  await expect(page.locator('.guia')).toContainText('Agregar a inicio');
  await expect(page.locator('.guia')).toContainText('sin reconocimiento facial');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test('impresa cabe en una sola hoja carta y el botón de imprimir no sale en papel', async ({ page }) => {
  await page.goto('instalar.html?org=Parques%20Alegres%20IAP');
  await expect(page.locator('#guia-codigo svg')).toBeVisible();
  await page.evaluate(() => { window.__impreso = false; window.print = () => { window.__impreso = true; }; });
  await page.locator('#guia-imprimir').click();
  expect(await page.evaluate(() => window.__impreso)).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.guia__barra')).toBeHidden();
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  const paginas = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
  expect(paginas).toBe(1);
});

test('funciona sin señal una vez abierta la app (queda guardada en el teléfono)', async ({ page, context }) => {
  await simularSupabase(page, { sitiosPA: 5 });
  await page.goto('index.html');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.setOffline(true);
  await page.goto('instalar.html');
  await expect(page.locator('#guia-codigo svg')).toBeVisible();
  await context.setOffline(false);
});

test('perfil: enlace a la guía con la organización y botón de instalar cuando Android lo ofrece', async ({ page }) => {
  await simularSupabase(page, { sitiosPA: 5 });
  await page.goto('index.html');
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#perfil-instalar')).toBeHidden();
  await expect(page.locator('#perfil-guia')).toHaveAttribute('href', 'instalar.html?org=Parques+Alegres+IAP');
  // Chrome en Android avisa que se puede instalar: aparece el botón y abre la invitación del sistema
  await page.evaluate(() => {
    const ev = new Event('beforeinstallprompt', { cancelable: true });
    ev.prompt = () => { window.__invitacion = true; };
    ev.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(ev);
  });
  await expect(page.locator('#perfil-instalar')).toBeVisible();
  await page.locator('#perfil-instalar').click();
  expect(await page.evaluate(() => window.__invitacion)).toBe(true);
  await expect(page.locator('#perfil-instalar')).toBeHidden();
});

test('panel › Personas: enlace a la guía para imprimir', async ({ page }) => {
  await simularSupabase(page, { sitiosPA: 5 });
  await page.goto('index.html');
  await entrar(page, USUARIOS.admin);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.goto('panel.html');
  await expect(page.locator('#personas-guia')).toHaveAttribute('href', 'instalar.html?org=Parques+Alegres+IAP');
});
