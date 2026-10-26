// =============================================================
// turnos.js — Definición de los turnos y de las personas
// -------------------------------------------------------------
// Un turno guardado es un objeto { codigo, inicio, fin }:
//   · Códigos fijos (M, T, N, FM, FT, FN, L, V): inicio y fin = null
//   · "H" (horario a medida, p. ej. los de Eva): inicio y fin "HH:MM"
// =============================================================

import { horaCorta } from './utils.js';

// Cada turno: nombre, hora de entrada, hora de salida y si acaba
// al día siguiente (+1). L (libre) y V (vacaciones) no tienen horas.
export const TURNOS = {
  M:  { nombre: 'Mañana',       inicio: '7:00',  fin: '15:00' },
  T:  { nombre: 'Tarde',        inicio: '15:00', fin: '23:00' },
  N:  { nombre: 'Noche',        inicio: '23:00', fin: '7:00',  diaSiguiente: true },
  FM: { nombre: 'Finde mañana', inicio: '7:00',  fin: '19:00' },
  FT: { nombre: 'Finde tarde',  inicio: '15:00', fin: '3:00',  diaSiguiente: true },
  FN: { nombre: 'Finde noche',  inicio: '23:00', fin: '11:00', diaSiguiente: true },
  L:  { nombre: 'Libre' },
  V:  { nombre: 'Vacaciones' },
  H:  { nombre: 'Horario' },    // horas a medida
};

/** Códigos con horario fijo, en el orden en que se muestran en los botones */
export const CODIGOS_FIJOS = ['M', 'T', 'N', 'FM', 'FT', 'FN', 'L', 'V'];

/** Personas (y "ambos" para eventos conjuntos) */
export const PERSONAS = {
  dani: { nombre: 'Dani' },
  eva: { nombre: 'Eva' },
  ambos: { nombre: 'Juntos' },
};

/** "N" → "23:00–7:00 (+1)"; "L" → "Libre"; vacío → "" (solo códigos fijos) */
export function textoHoras(codigo) {
  const t = TURNOS[codigo];
  if (!t) return '';
  if (!t.inicio) return t.nombre;
  return `${t.inicio}–${t.fin}${t.diaSiguiente ? ' (+1)' : ''}`;
}

/** "17:00" → "17"; "07:30" → "7:30" (para que quepa en la vista mes) */
export function horaCompacta(hora) {
  return horaCorta(hora).replace(/:00$/, '');
}

/** Texto corto para la vista mes: "M", "FN", "17-22" o "7:30" */
export function etiquetaCorta(turno) {
  if (!turno) return '';
  if (turno.codigo !== 'H') return turno.codigo;
  const texto = `${horaCompacta(turno.inicio)}-${horaCompacta(turno.fin)}`;
  return texto.length <= 5 ? texto : horaCompacta(turno.inicio);
}

/** Texto con horas: "7:00–15:00", "17:00–22:00", "Libre", "Vacaciones" */
export function etiquetaLarga(turno) {
  if (!turno) return '';
  if (turno.codigo !== 'H') return textoHoras(turno.codigo);
  const masUno = turno.fin <= turno.inicio ? ' (+1)' : '';
  return `${horaCorta(turno.inicio)}–${horaCorta(turno.fin)}${masUno}`;
}

/** Nombre del turno: "Mañana", "Libre", "Horario" */
export const nombreTurno = turno => (turno ? TURNOS[turno.codigo]?.nombre || turno.codigo : 'Sin turno');

/** ¿Son el mismo turno? (sirve para saber si algo ha cambiado) */
export function mismoTurno(a, b) {
  if (!a || !b) return !a && !b;
  return a.codigo === b.codigo && (a.inicio || null) === (b.inicio || null) && (a.fin || null) === (b.fin || null);
}

/** Crea un turno a partir de un código o de unas horas */
export function crearTurno(codigo, inicio = null, fin = null) {
  return codigo === 'H' ? { codigo, inicio, fin } : { codigo, inicio: null, fin: null };
}

/** ¿Ese código es un día de trabajo? */
export const trabaja = codigo => Boolean(codigo) && codigo !== 'L' && codigo !== 'V';

/** ¿Ese día está libre? (L, vacaciones o sin turno puesto) */
export const estaLibre = codigo => !codigo || codigo === 'L' || codigo === 'V';
