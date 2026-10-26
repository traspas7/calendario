// =============================================================
// turnos.js — Definición de los turnos y de las personas
// =============================================================

// Cada turno: nombre, hora de entrada, hora de salida y si acaba
// al día siguiente (+1). "L" es libre y no tiene horas.
export const TURNOS = {
  M:  { nombre: 'Mañana',       inicio: '7:00',  fin: '15:00' },
  T:  { nombre: 'Tarde',        inicio: '15:00', fin: '23:00' },
  N:  { nombre: 'Noche',        inicio: '23:00', fin: '7:00',  diaSiguiente: true },
  FM: { nombre: 'Finde mañana', inicio: '7:00',  fin: '19:00' },
  FT: { nombre: 'Finde tarde',  inicio: '15:00', fin: '3:00',  diaSiguiente: true },
  FN: { nombre: 'Finde noche',  inicio: '23:00', fin: '11:00', diaSiguiente: true },
  L:  { nombre: 'Libre' },
};

/** Lista de códigos en el orden en que se muestran: M, T, N, FM, FT, FN, L */
export const CODIGOS = Object.keys(TURNOS);

/** Personas (y "ambos" para eventos conjuntos) */
export const PERSONAS = {
  dani: { nombre: 'Dani' },
  eva: { nombre: 'Eva' },
  ambos: { nombre: 'Juntos' },
};

/** "N" → "23:00–7:00 (+1)"; "L" → "Libre"; vacío → "" */
export function textoHoras(codigo) {
  const t = TURNOS[codigo];
  if (!t) return '';
  if (!t.inicio) return 'Libre';
  return `${t.inicio}–${t.fin}${t.diaSiguiente ? ' (+1)' : ''}`;
}

/** ¿Ese código es un día de trabajo? */
export const trabaja = codigo => Boolean(codigo) && codigo !== 'L';

/** ¿Ese día está libre? (L o sin turno puesto) */
export const estaLibre = codigo => !codigo || codigo === 'L';
