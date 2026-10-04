// Arma index_un_archivo.ts = index.ts con logica.js incluido (para publicar en el editor de Supabase pegando un solo
// archivo). Uso: node supabase/functions/alta-persona/armar_un_archivo.mjs · La prueba hu09 verifica que esté al día.
import { readFileSync, writeFileSync } from 'node:fs';

export function armar() {
  const aqui = new URL('./', import.meta.url);
  const index = readFileSync(new URL('index.ts', aqui), 'utf8');
  const logica = readFileSync(new URL('logica.js', aqui), 'utf8');
  const importacion = "import { atender } from './logica.js';\n";
  if (!index.includes(importacion)) throw new Error('index.ts ya no importa logica.js como se esperaba');
  return '// @ts-nocheck  (logica.js es JavaScript: no se revisan tipos)\n// ARCHIVO GENERADO: no editar. Es index.ts + logica.js en uno solo (ver armar_un_archivo.mjs).\n'
    + index.replace(importacion, `\n// ----- logica.js -----\n${logica}\n// ----- fin de logica.js -----\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(new URL('index_un_archivo.ts', import.meta.url), armar());
  console.log('index_un_archivo.ts actualizado');
}
