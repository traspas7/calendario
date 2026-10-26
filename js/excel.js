// =============================================================
// excel.js — Leer el cuadrante desde Excel (archivo o pegado)
// -------------------------------------------------------------
// Es mucho más fiable que una foto: cada celda está en su columna,
// así que se sabe a qué día corresponde aunque esté vacía.
//
// Cómo encuentra los turnos:
//  1) Busca la fila con el nombre de la persona.
//  2) Sube hacia arriba hasta encontrar la fila con los números de
//     día (1, 2, 3 … 30) → así sabe qué columna es cada día.
//  3) Lee la celda de cada día en la fila de la persona.
//     Celda vacía = Libre (así funciona el cuadrante de Dani).
// =============================================================

import { cargarScript } from './utils.js';
import { buscarFila, normalizar } from './ocr.js';
import { CODIGOS_FIJOS, crearTurno } from './turnos.js';

// SheetJS: librería gratuita que lee .xlsx en el navegador (sin servidor)
const URL_XLSX = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';

/** Abre un archivo Excel y devuelve el "libro" con todas sus hojas */
export async function leerLibro(archivo) {
  if (!window.XLSX) await cargarScript(URL_XLSX);
  const datos = await archivo.arrayBuffer();
  return window.XLSX.read(datos, { type: 'array' });
}

/** Hoja del libro → tabla (array de filas, cada fila array de celdas) */
export function hojaATabla(libro, nombreHoja) {
  return window.XLSX.utils.sheet_to_json(libro.Sheets[nombreHoja], {
    header: 1, raw: true, defval: '', blankrows: true,
  });
}

/** Texto copiado de Excel (columnas separadas por tabulador) → tabla */
export function textoATabla(texto) {
  return texto.replace(/\r/g, '').split('\n').map(fila => fila.split('\t'));
}

// Abreviaturas de los meses tal como suelen salir en las pestañas
// (en el cuadrante de Dani: ENE26, FEB26 … AGT26 … NOV26, DIC25+NAV)
const MESES_HOJA = [['ENE'], ['FEB'], ['MAR'], ['ABR'], ['MAY'], ['JUN'], ['JUL'],
  ['AGO', 'AGT', 'AG'], ['SEP', 'SET'], ['OCT'], ['NOV'], ['DIC']];

/** "NOV26" → { mes: 10, anio: 2026 } (o null si no se reconoce) */
export function mesDeHoja(nombreHoja) {
  const n = normalizar(nombreHoja);
  for (let mes = 0; mes < 12; mes++) {
    for (const abrev of MESES_HOJA[mes]) {
      const m = n.match(new RegExp(`(?:^|[^A-Z])${abrev}[A-Z]*\\s*[-_ ]?(\\d{2}|\\d{4})(?!\\d)`));
      if (m) return { mes, anio: m[1].length === 2 ? 2000 + Number(m[1]) : Number(m[1]) };
    }
  }
  return null;
}

/** Hoja que corresponde al mes elegido (o la primera si no hay ninguna) */
export function elegirHoja(libro, mes, anio) {
  return libro.SheetNames.find(h => {
    const m = mesDeHoja(h);
    return m && m.mes === mes && m.anio === anio;
  }) || libro.SheetNames[0];
}

/** Celda → número de día (1-31) o null. Acepta números, texto y fechas de Excel */
function diaDeCelda(valor) {
  if (typeof valor === 'number') {
    if (Number.isInteger(valor) && valor >= 1 && valor <= 31) return valor;
    if (valor > 20000 && window.XLSX) return window.XLSX.SSF.parse_date_code(valor)?.d || null; // fecha de Excel
    return null;
  }
  const texto = String(valor ?? '').trim();
  if (/^\d{1,2}$/.test(texto)) {
    const n = Number(texto);
    return n >= 1 && n <= 31 ? n : null;
  }
  return null;
}

/**
 * Busca hacia arriba (desde la fila del nombre) la fila con los días
 * 1, 2, 3… seguidos. Devuelve { dia: columna } o null.
 */
function buscarCabecera(tabla, filaNombre, diasMes) {
  const necesarios = Math.min(28, diasMes);
  for (let h = filaNombre - 1; h >= Math.max(0, filaNombre - 80); h--) {
    const fila = tabla[h] || [];
    let mapa = {}, esperado = 1;
    for (let c = 0; c < fila.length; c++) {
      const d = diaDeCelda(fila[c]);
      if (d === esperado) { mapa[d] = c; esperado++; } else if (d === 1) { mapa = { 1: c }; esperado = 2; }
      if (esperado > diasMes) break;
    }
    if (esperado - 1 >= necesarios) return mapa;
  }
  return null;
}

/**
 * Valor de una celda → turno.
 * Vacía → Libre · M/T/N/FM/FT/FN/L/V → ese código · "VAC…" → V ·
 * "17-22" o "7:30-11:30" → horario a medida · otra cosa → undefined (dudoso)
 */
export function valorATurno(valor) {
  const s = normalizar(String(valor ?? '')).replace(/\s+/g, '');
  if (!s) return crearTurno('L');
  if (CODIGOS_FIJOS.includes(s)) return crearTurno(s);
  if (s === 'LIBRE' || s === 'DESCANSO') return crearTurno('L');
  if (s.startsWith('VAC')) return crearTurno('V');
  const m = s.match(/^(\d{1,2})(?:[:.H](\d{2}))?(?:-|A)(\d{1,2})(?:[:.H](\d{2}))?$/);
  if (m) {
    const hora = (h, min) => `${String(h).padStart(2, '0')}:${min || '00'}`;
    if (Number(m[1]) < 24 && Number(m[3]) < 24) return crearTurno('H', hora(m[1], m[2]), hora(m[3], m[4]));
  }
  return undefined;
}

/**
 * Extrae los turnos del mes de una tabla.
 * Devuelve { celdas: [turno|null por día], fila, aviso, dudosos, textoFila }
 * o { error } si no encuentra el nombre.
 */
export function extraerDeTabla(tabla, nombre, diasMes) {
  const lineas = tabla.map(fila => fila.map(c => String(c ?? '')).join(' '));
  const r = buscarFila(lineas, nombre);
  if (r < 0) return { error: `No he encontrado a «${nombre}» en la hoja.` };

  const fila = tabla[r];
  // Columna del nombre: la última celda que contiene parte del nombre
  let colNombre = 0;
  fila.forEach((c, i) => { if (String(c).trim() && buscarFila([String(c)], nombre) === 0) colNombre = i; });

  const cabecera = buscarCabecera(tabla, r, diasMes);
  let aviso = '';
  if (!cabecera) {
    aviso = 'No he encontrado la fila con los números de los días; he supuesto que los días van seguidos justo después del nombre. ';
  }

  const celdas = [];
  const dudosos = [];
  for (let d = 1; d <= diasMes; d++) {
    const col = cabecera ? cabecera[d] : colNombre + d;
    if (col === undefined) { celdas.push(null); continue; }
    const valor = fila[col];
    const turno = valorATurno(valor);
    if (turno === undefined) { celdas.push(null); dudosos.push(`día ${d}: «${valor}»`); } else celdas.push(turno);
  }
  return { celdas, fila: r, aviso, dudosos, textoFila: lineas[r] };
}
