// HU-08 · Inicio de sesión: correo + contraseña, sesión persistente, sin alta → mensaje y cierre, selector de 2 organizaciones.
import { test, expect } from '@playwright/test';
import { simularSupabase, entrar, senal, USUARIOS } from './simulador.js';

let sim;

test.beforeEach(async ({ page }) => {
  sim = await simularSupabase(page);
  await page.goto('index.html');
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
});

test('entra con correo y contraseña y ve su nombre y organización', async ({ page }) => {
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#titulo-vista')).toHaveText('Hola, Asesor');
  await expect(page.locator('#org-nombre')).toHaveText('Parques Alegres IAP');
  await expect(page.locator('#avatar')).toHaveText('AD');
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#perfil-nombre')).toHaveText('Asesor de Prueba');
  await expect(page.locator('#perfil-rol')).toHaveText('Asesoría');
  await expect(page.locator('#perfil-correo')).toHaveText('asesor@prueba.test');
  await expect(page.locator('#perfil-cambiar-org')).toBeHidden();
});

test('contraseña incorrecta muestra mensaje claro', async ({ page }) => {
  await entrar(page, { ...USUARIOS.asesor, clave: 'mala' });
  await expect(page.locator('#acceso-error')).toHaveText('Correo o contraseña incorrectos.');
  await expect(page.locator('#pantalla-app')).toBeHidden();
});

test('campos vacíos no llaman al servidor', async ({ page }) => {
  await page.locator('#acceso-entrar').click();
  await expect(page.locator('#acceso-error')).toHaveText('Escribe tu correo y tu contraseña.');
});

test('la sesión persiste al recargar', async ({ page }) => {
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#titulo-vista')).toHaveText('Hola, Asesor');
});

test('usuario sin fila en miembros: mensaje y cierre de sesión', async ({ page }) => {
  await entrar(page, USUARIOS.sinAlta);
  await expect(page.locator('#acceso-error')).toContainText('no tiene un alta activa');
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
  const guardada = await page.evaluate(() => localStorage.getItem('asis-auth'));
  expect(guardada).toBeNull();
  await page.reload();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
});

test('usuario dado de baja (miembro inactivo): mensaje y cierre de sesión', async ({ page }) => {
  await entrar(page, USUARIOS.baja);
  await expect(page.locator('#acceso-error')).toContainText('no tiene un alta activa');
  expect(await page.evaluate(() => localStorage.getItem('asis-auth'))).toBeNull();
});

test('pertenece a 2 organizaciones: elige, recuerda la elección y puede cambiarla', async ({ page }) => {
  await entrar(page, USUARIOS.dosOrgs);
  await expect(page.locator('#pantalla-organizacion')).toBeVisible();
  await expect(page.locator('#lista-organizaciones .opcion')).toHaveCount(2);
  await page.locator('#lista-organizaciones .opcion', { hasText: 'IAP Demo' }).click();
  await expect(page.locator('#org-nombre')).toHaveText('IAP Demo');
  await page.reload();
  await expect(page.locator('#org-nombre')).toHaveText('IAP Demo');
  await page.locator('[data-pestana="perfil"]').click();
  await expect(page.locator('#perfil-rol')).toHaveText('Coordinación');
  await page.locator('#perfil-cambiar-org').click();
  await page.locator('#lista-organizaciones .opcion', { hasText: 'Parques Alegres' }).click();
  await expect(page.locator('#org-nombre')).toHaveText('Parques Alegres IAP');
  await expect(page.locator('#perfil-rol')).toHaveText('Asesoría');
});

test('cerrar sesión regresa a la pantalla de acceso', async ({ page }) => {
  await entrar(page, USUARIOS.asesor);
  await page.locator('[data-pestana="perfil"]').click();
  await page.locator('#perfil-salir').click();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
  await page.reload();
  await expect(page.locator('#pantalla-acceso')).toBeVisible();
});

test('sin señal: no se puede iniciar sesión por primera vez (mensaje claro)', async ({ page, context }) => {
  await senal(context, sim, false);
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#acceso-error')).toContainText('Sin conexión');
  await senal(context, sim, true);
});

test('sin señal y con el token vencido: la app abre con la sesión guardada', async ({ page, context }) => {
  await entrar(page, USUARIOS.asesor);
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  // Simula que pasaron horas: el token del teléfono ya venció.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('asis-auth'));
    s.expires_at = Math.floor(Date.now() / 1000) - 3600;
    localStorage.setItem('asis-auth', JSON.stringify(s));
  });
  await senal(context, sim, false);
  await page.reload();
  await expect(page.locator('#pantalla-app')).toBeVisible();
  await expect(page.locator('#titulo-vista')).toHaveText('Hola, Asesor');
  await expect(page.locator('#aviso-sin-conexion')).toBeVisible();
  // Al volver la señal se renueva el token y desaparece el aviso.
  await senal(context, sim, true);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#aviso-sin-conexion')).toBeHidden();
});
