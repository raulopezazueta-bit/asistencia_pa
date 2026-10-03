// Seguridad: el código y las fuentes de terceros no cambian sin que se note (docs/DEPENDENCIAS.md).
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const RAIZ = new URL('..', import.meta.url);

test('los archivos de terceros coinciden con sus huellas SHA-256', () => {
  const lineas = readFileSync(new URL('vendor/HUELLAS.sha256', RAIZ), 'utf8').trim().split('\n');
  expect(lineas.length).toBeGreaterThanOrEqual(6);
  for (const linea of lineas) {
    const [huella, archivo] = linea.split(/\s+\*?/);
    const real = createHash('sha256').update(readFileSync(new URL(archivo, RAIZ))).digest('hex');
    expect(real, `${archivo} cambió`).toBe(huella);
  }
});
