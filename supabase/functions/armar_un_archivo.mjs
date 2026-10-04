// Arma <función>/index_un_archivo.ts = index.ts con sus módulos locales incluidos, para publicarlo en el editor de
// Supabase pegando un solo archivo. Uso: node supabase/functions/armar_un_archivo.mjs · Las pruebas verifican que
// los archivos generados estén al día.
import { readFileSync, writeFileSync } from 'node:fs';

const AQUI = new URL('./', import.meta.url);
const leer = (ruta) => readFileSync(new URL(ruta, AQUI), 'utf8');
// Módulos que se incluyen, en orden; cada import local se quita del archivo que lo tenía
const PIEZAS = {
  'alta-persona': [['logica.js', "import { atender } from './logica.js';\n"]],
  avisos: [['../../js/reglas.js', "import { partesLocales, horarioDelDia, calcularEstado } from '../../../js/reglas.js';\n"],
    ['logica.js', "import { avisosPendientes } from './logica.js';\n"]]
};

export function armar(funcion) {
  const importaciones = PIEZAS[funcion].map(([, imp]) => imp);
  const quitar = (codigo) => importaciones.reduce((c, imp) => c.replace(imp, ''), codigo);
  let index = quitar(leer(`${funcion}/index.ts`));
  const incluidos = PIEZAS[funcion].map(([ruta]) => {
    const nombre = ruta.replace('../../', '');
    return `\n// ----- ${nombre} -----\n${quitar(leer(ruta.startsWith('../') ? ruta : `${funcion}/${ruta}`))}\n// ----- fin de ${nombre} -----\n`;
  });
  const corte = index.indexOf('\n', index.lastIndexOf('\nimport ') + 1) + 1;
  const salida = '// @ts-nocheck  (los módulos incluidos son JavaScript: no se revisan tipos)\n'
    + `// ARCHIVO GENERADO: no editar. Es ${funcion}/index.ts con sus módulos incluidos (ver supabase/functions/armar_un_archivo.mjs).\n`
    + index.slice(0, corte) + incluidos.join('') + index.slice(corte);
  if (/from '\.{1,2}\//.test(salida)) throw new Error(`${funcion}: quedó una importación local sin incluir`);
  return salida;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const f of Object.keys(PIEZAS)) {
    writeFileSync(new URL(`${f}/index_un_archivo.ts`, AQUI), armar(f));
    console.log(`${f}/index_un_archivo.ts actualizado`);
  }
}
