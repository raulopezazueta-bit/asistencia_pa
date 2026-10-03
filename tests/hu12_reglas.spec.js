// HU-12 · Pruebas unitarias de js/reglas.js (máquina de estados de la jornada, ESPECIFICACION §2).
// Casos pedidos: día normal, olvido de fin, pausa abierta, sin horario. Fecha base: lunes 5-oct-2026, Culiacán.
import { test, expect } from '@playwright/test';
import { calcularEstado, pasosPara, resumenDelDia, horarioDelDia, partesLocales } from '../js/reglas.js';

const ZONA = 'America/Mazatlan';
const a = (hhmm) => new Date(`2026-10-05T${hhmm}:00-07:00`);
let n = 0;
const ev = (tipo, hhmm, extra = {}) => ({ id: `e${++n}`, tipo, hora: a(hhmm).toISOString(), ...extra });
const HORARIO = [
  { bloque: 'escritorio', inicio: '09:00', fin: '13:00', modalidad: 'teletrabajo' },
  { bloque: 'campo', inicio: '16:00', fin: '20:00', modalidad: 'presencial' }
];
const estado = (eventos, hhmm, horario = HORARIO, config = {}) => calcularEstado({ eventos, horario, ahora: a(hhmm), zona: ZONA, config });

test.describe('día normal (jornada partida)', () => {
  const dia = [
    ev('inicio_bloque', '09:01', { bloque: 'escritorio', modalidad: 'teletrabajo' }),
    ev('fin_bloque', '13:04', { bloque: 'escritorio' }),
    ev('inicio_pausa', '13:04'),
    ev('fin_pausa', '13:55'),
    ev('inicio_bloque', '16:03', { bloque: 'campo' }),
    ev('llegada_sitio', '16:10', { sitioId: 's1', sitioNombre: 'Parque Uno' }),
    ev('salida_sitio', '16:58'),
    ev('fin_bloque', '20:02', { bloque: 'campo' })
  ];
  const hasta = (k) => dia.slice(0, k);

  test('8:30 sin eventos → sin_jornada, iniciar escritorio', () => {
    const e = estado([], '08:30');
    expect(e.estado).toBe('sin_jornada');
    expect(e.boton).toMatchObject({ texto: 'Iniciar bloque de escritorio', accion: 'inicio_bloque', bloque: 'escritorio' });
    expect(e.boton.detalle).toBe('Teletrabajo · Programado 09:00 – 13:00');
    expect(e.secundarias).toContainEqual({ accion: 'inicio_bloque', bloque: 'campo', texto: 'Iniciar bloque de campo' });
  });

  test('en bloque de escritorio → terminar, pausa disponible, sin llegada a parque', () => {
    const e = estado(hasta(1), '10:00');
    expect(e.estado).toBe('en_bloque');
    expect(e.boton.texto).toBe('Terminar bloque de escritorio');
    expect(e.secundarias.map((s) => s.accion)).toEqual(['inicio_pausa']);
    expect(e.alertas).toEqual([]);
  });

  test('tras cerrar escritorio → entre_bloques, iniciar campo, comida disponible', () => {
    const e = estado(hasta(2), '13:05');
    expect(e.estado).toBe('entre_bloques');
    expect(e.boton).toMatchObject({ texto: 'Iniciar bloque de campo', bloque: 'campo' });
    expect(e.secundarias[0]).toEqual({ accion: 'inicio_pausa', texto: 'Iniciar comida' });
  });

  test('comida entre bloques → en_pausa y luego entre_bloques', () => {
    expect(estado(hasta(3), '13:30')).toMatchObject({ estado: 'en_pausa', boton: { texto: 'Regresar de la pausa', detalle: 'Comida entre bloques' } });
    expect(estado(hasta(4), '14:00').estado).toBe('entre_bloques');
  });

  test('en campo → registrar llegada a parque', () => {
    const e = estado(hasta(5), '16:05');
    expect(e.boton.texto).toBe('Terminar bloque de campo');
    expect(e.secundarias.map((s) => s.texto)).toEqual(['Registrar llegada a parque', 'Iniciar comida/pausa']);
  });

  test('en un parque → subestado en_sitio con salir y llegar a otro', () => {
    const e = estado(hasta(6), '16:20');
    expect(e.estado).toBe('en_bloque');
    expect(e.enSitio).toEqual({ id: 's1', nombre: 'Parque Uno' });
    expect(e.boton).toMatchObject({ texto: 'Terminar bloque de campo', detalle: 'Estás en Parque Uno' });
    expect(e.secundarias.map((s) => s.texto)).toEqual(['Salir de Parque Uno', 'Llegar a otro parque', 'Iniciar comida/pausa']);
    expect(pasosPara(e, 'cambio_sitio', { sitio: { id: 's2', nombre: 'Parque Dos' } }).map((p) => p.tipo)).toEqual(['salida_sitio', 'llegada_sitio']);
  });

  test('tras salir del parque vuelve a ofrecer llegada', () => {
    expect(estado(hasta(7), '17:00').enSitio).toBeNull();
  });

  test('fin del último bloque → jornada_cerrada, sin botón principal, solicitar corrección', () => {
    const e = estado(dia, '20:05');
    expect(e.estado).toBe('jornada_cerrada');
    expect(e.boton).toBeNull();
    expect(e.secundarias).toEqual([{ accion: 'solicitar_correccion', texto: 'Solicitar corrección' }]);
  });

  test('resumen: minutos efectivos (la comida entre bloques no resta) y en regla', () => {
    const r = resumenDelDia({ eventos: dia, horario: HORARIO, ahora: a('20:05'), zona: ZONA });
    // escritorio 9:01–13:04 = 243 min; campo 16:03–20:02 = 239 min
    expect(r.minutosEfectivos).toBe(482);
    expect(r.minutosProgramados).toBe(480);
    expect(r.calificacion).toBe('en_regla');
    expect(r.filas.map((f) => `${f.tipo}:${f.estado}`)).toEqual(['bloque:cerrado', 'pausa:cerrada', 'bloque:cerrado']);
  });

  test('a mitad de jornada el resumen muestra el pendiente al final', () => {
    const r = resumenDelDia({ eventos: hasta(4), horario: HORARIO, ahora: a('14:00'), zona: ZONA });
    expect(r.filas.map((f) => `${f.tipo}:${f.bloque ?? ''}:${f.estado}`)).toEqual(['bloque:escritorio:cerrado', 'pausa::cerrada', 'bloque:campo:pendiente']);
    expect(r.minutosEfectivos).toBe(243);
  });
});

test.describe('olvido de fin', () => {
  test('bloque de escritorio abierto a las 16:00 → alerta, sigue ofreciendo terminarlo', () => {
    const e = estado([ev('inicio_bloque', '09:00', { bloque: 'escritorio' })], '16:00');
    expect(e.estado).toBe('en_bloque');
    expect(e.boton.texto).toBe('Terminar bloque de escritorio');
    expect(e.alertas).toHaveLength(1);
    expect(e.alertas[0].tipo).toBe('olvido_fin');
    expect(e.alertas[0].texto).toContain('¿Olvidaste checar salida?');
  });

  test('la alerta respeta el margen (30 min por defecto, configurable)', () => {
    const abierto = [ev('inicio_bloque', '16:00', { bloque: 'campo' })];
    expect(estado(abierto, '20:30').alertas).toHaveLength(0);
    expect(estado(abierto, '20:31').alertas).toHaveLength(1);
    expect(estado(abierto, '20:16', HORARIO, { recordatorio_salida_min: 15 }).alertas).toHaveLength(1);
  });

  test('iniciar otro bloque sin cerrar el anterior queda como anomalía y el día pasa a revisar', () => {
    const eventos = [ev('inicio_bloque', '09:00', { bloque: 'escritorio' }), ev('inicio_bloque', '16:00', { bloque: 'campo' })];
    const e = estado(eventos, '17:00');
    expect(e.bloqueAbierto).toBe('campo');
    expect(e.anomalias).toEqual([{ tipo: 'bloque_sin_fin', bloque: 'escritorio' }]);
    expect(resumenDelDia({ eventos, horario: HORARIO, ahora: a('17:00'), zona: ZONA }).calificacion).toBe('revisar');
  });
});

test.describe('pausa abierta', () => {
  const eventos = [ev('inicio_bloque', '16:00', { bloque: 'campo' }), ev('llegada_sitio', '16:05', { sitioNombre: 'Parque Uno' }), ev('inicio_pausa', '18:00')];

  test('en pausa dentro del bloque → regresar de la pausa; como salida directa, terminar el bloque (HU-13)', () => {
    const e = estado(eventos, '18:10');
    expect(e.estado).toBe('en_pausa');
    expect(e.boton).toMatchObject({ texto: 'Regresar de la pausa', accion: 'fin_pausa', detalle: 'Bloque de campo en pausa' });
    expect(e.secundarias).toEqual([{ accion: 'fin_bloque', bloque: 'campo', texto: 'Terminar bloque de campo' }]);
  });

  test('comida entre bloques → iniciar el siguiente bloque registra primero el regreso (confirmado)', () => {
    const comida = [ev('inicio_bloque', '09:00', { bloque: 'escritorio' }), ev('fin_bloque', '13:00', { bloque: 'escritorio' }), ev('inicio_pausa', '13:05')];
    const e = estado(comida, '15:55');
    expect(e.estado).toBe('en_pausa');
    expect(e.boton.detalle).toBe('Comida entre bloques');
    expect(e.secundarias).toEqual([{ accion: 'inicio_bloque', bloque: 'campo', texto: 'Iniciar bloque de campo' }]);
    const pasos = pasosPara(e, 'inicio_bloque', { bloque: 'campo' });
    expect(pasos.map((p) => p.tipo)).toEqual(['fin_pausa', 'inicio_bloque']);
    expect(pasos[0].confirmar).toMatch(/regreso de la pausa/);
  });

  test('pausa que se alarga más allá del fin del bloque también avisa olvido', () => {
    expect(estado(eventos, '20:45').alertas.map((a) => a.tipo)).toEqual(['olvido_fin']);
  });

  test('terminar el bloque estando en pausa y en un parque → fin_pausa (confirmado), salida_sitio, fin_bloque', () => {
    const pasos = pasosPara(estado(eventos, '18:10'), 'fin_bloque');
    expect(pasos.map((p) => p.tipo)).toEqual(['fin_pausa', 'salida_sitio', 'fin_bloque']);
    expect(pasos[0].confirmar).toMatch(/¿Continuar\?$/);
    expect(pasos[2].bloque).toBe('campo');
  });

  test('la pausa dentro del bloque sí resta minutos (abierta: hasta ahora)', () => {
    const r = resumenDelDia({ eventos, horario: HORARIO, ahora: a('18:20'), zona: ZONA });
    expect(r.minutosEfectivos).toBe(120);   // 16:00–18:20 = 140, menos 20 de pausa
  });
});

test.describe('sin horario cargado', () => {
  test('sin eventos → pregunta qué bloque inicia', () => {
    const e = estado([], '10:00', []);
    expect(e.estado).toBe('sin_jornada');
    expect(e.preguntarBloque).toBe(true);
    expect(e.boton).toMatchObject({ texto: 'Iniciar bloque', bloque: null, detalle: '¿Qué bloque inicias? Lo eliges al checar' });
  });

  test('tras cerrar un bloque ofrece el otro; con ambos cerrados, jornada cerrada', () => {
    const uno = [ev('inicio_bloque', '09:00', { bloque: 'escritorio' }), ev('fin_bloque', '13:00', { bloque: 'escritorio' })];
    expect(estado(uno, '14:00', [])).toMatchObject({ estado: 'entre_bloques', boton: { texto: 'Iniciar bloque de campo' } });
    const dos = [...uno, ev('inicio_bloque', '16:00', { bloque: 'campo' }), ev('fin_bloque', '20:00', { bloque: 'campo' })];
    expect(estado(dos, '20:05', []).estado).toBe('jornada_cerrada');
  });

  test('sin horario no hay alerta de olvido (no hay hora de fin con qué comparar)', () => {
    expect(estado([ev('inicio_bloque', '09:00', { bloque: 'campo' })], '23:00', []).alertas).toEqual([]);
  });
});

test.describe('elección del bloque según la hora', () => {
  test('a las 14:00 sin haber checado escritorio, toca campo (escritorio ya pasó)', () => {
    const e = estado([], '14:00');
    expect(e.boton.bloque).toBe('campo');
    expect(e.secundarias).toContainEqual({ accion: 'inicio_bloque', bloque: 'escritorio', texto: 'Iniciar bloque de escritorio' });
  });

  test('a las 21:00 sin nada checado, ofrece el último bloque pendiente', () => {
    expect(estado([], '21:00').boton.bloque).toBe('campo');
  });

  test('horario de un solo bloque: al cerrarlo, jornada cerrada', () => {
    const soloCampo = [HORARIO[1]];
    const ev2 = [ev('inicio_bloque', '16:00', { bloque: 'campo' }), ev('fin_bloque', '20:00', { bloque: 'campo' })];
    expect(estado(ev2, '20:01', soloCampo).estado).toBe('jornada_cerrada');
  });

  test('los eventos desordenados se ordenan por hora', () => {
    const e = estado([ev('fin_bloque', '13:00', { bloque: 'escritorio' }), ev('inicio_bloque', '09:00', { bloque: 'escritorio' })], '13:10');
    expect(e.estado).toBe('entre_bloques');
  });
});

test.describe('retardo y revisión', () => {
  test('entrar después de la tolerancia (10 min por defecto) → retardo', () => {
    const eventos = [ev('inicio_bloque', '09:11', { bloque: 'escritorio' })];
    expect(resumenDelDia({ eventos, horario: HORARIO, ahora: a('10:00'), zona: ZONA }).calificacion).toBe('retardo');
    expect(resumenDelDia({ eventos, horario: HORARIO, ahora: a('10:00'), zona: ZONA, config: { tolerancia_entrada_min: 15 } }).calificacion).toBe('en_regla');
  });

  test('un evento marcado "revisar" por el servidor → revisar', () => {
    const eventos = [ev('inicio_bloque', '09:00', { bloque: 'escritorio', estadoRevision: 'revisar' })];
    expect(resumenDelDia({ eventos, horario: HORARIO, ahora: a('10:00'), zona: ZONA }).calificacion).toBe('revisar');
  });
});

test.describe('horario del día desde la tabla horarios', () => {
  const filas = [
    { dia_semana: 1, bloque: 'campo', hora_inicio: '16:00:00', hora_fin: '20:00:00', modalidad: 'presencial', vigente_desde: '2026-01-01', vigente_hasta: null },
    { dia_semana: 1, bloque: 'escritorio', hora_inicio: '09:00:00', hora_fin: '13:00:00', modalidad: 'teletrabajo', vigente_desde: '2026-01-01', vigente_hasta: null },
    { dia_semana: 2, bloque: 'campo', hora_inicio: '10:00:00', hora_fin: '14:00:00', modalidad: 'presencial', vigente_desde: '2026-01-01', vigente_hasta: null },
    { dia_semana: 1, bloque: 'campo', hora_inicio: '15:00:00', hora_fin: '19:00:00', modalidad: 'presencial', vigente_desde: '2025-01-01', vigente_hasta: '2025-12-31' }
  ];
  test('filtra por día ISO (lunes = 1) y vigencia, y ordena por hora', () => {
    expect(horarioDelDia(filas, a('08:00'), ZONA)).toEqual(HORARIO);
  });
  test('la fecha y hora se calculan en la zona de la organización, no la del teléfono', () => {
    // 23:30 del lunes en Culiacán es martes 06:30 UTC
    expect(partesLocales(new Date('2026-10-06T06:30:00Z'), ZONA)).toEqual({ fecha: '2026-10-05', diaIso: 1, minutos: 23 * 60 + 30 });
  });
});
