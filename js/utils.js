// =============================================================
// utils.js — Utilidades generales: fechas, textos, avisos
// =============================================================

// ---------- Nombres en español (la semana empieza en lunes) ----------
export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
export const DIAS_CORTOS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
export const DIAS_ABREV = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
export const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// ---------- Fechas ----------
// Trabajamos con fechas en texto "AAAA-MM-DD" (formato ISO) en hora LOCAL,
// así evitamos líos de zonas horarias al guardar en la base de datos.
const dos = n => String(n).padStart(2, '0');

/** Date → "2026-10-26" */
export function aISO(fecha) {
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

/** "2026-10-26" → Date (a las 00:00 locales) */
export function deISO(texto) {
  const [a, m, d] = texto.split('-').map(Number);
  return new Date(a, m - 1, d);
}

/** Devuelve una nueva fecha sumando (o restando) días */
export function sumarDias(fecha, n) {
  const r = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

/** Día de la semana con lunes = 0 … domingo = 6 */
export function diaSemana(fecha) {
  return (fecha.getDay() + 6) % 7;
}

/** Lunes de la semana a la que pertenece la fecha */
export function inicioSemana(fecha) {
  return sumarDias(fecha, -diaSemana(fecha));
}

/** Número de días de un mes (mes de 0 a 11) */
export function diasEnMes(anio, mes) {
  return new Date(anio, mes + 1, 0).getDate();
}

export const hoyISO = () => aISO(new Date());

export const capitalizar = t => t.charAt(0).toUpperCase() + t.slice(1);

/** "2026-10-26" → "Lunes, 26 de octubre" */
export function fechaLarga(iso) {
  const f = deISO(iso);
  return `${capitalizar(DIAS_LARGOS[diaSemana(f)])}, ${f.getDate()} de ${MESES[f.getMonth()]}`;
}

/** "07:30:00" o "07:30" → "7:30" */
export function horaCorta(hora) {
  if (!hora) return '';
  const [h, m] = hora.split(':');
  return `${Number(h)}:${m}`;
}

// ---------- Seguridad: escapar texto antes de meterlo en HTML ----------
// Evita que un título o nota con "<script>" se ejecute (ataque XSS).
export function escaparHTML(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ---------- Error especial para "no hay conexión" ----------
export class ErrorConexion extends Error {
  constructor(mensaje = 'Sin conexión') {
    super(mensaje);
    this.name = 'ErrorConexion';
  }
}

// ---------- Mensajes flotantes (toast) ----------
let temporizadorToast;
export function toast(mensaje, tipo = 'info') {
  const el = document.getElementById('toast');
  el.textContent = mensaje;
  el.className = `toast toast--${tipo} toast--visible`;
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.classList.remove('toast--visible'), 3200);
}

/** Muestra un error de guardado de forma amigable */
export function avisarError(error) {
  if (error instanceof ErrorConexion) {
    toast('📴 Sin conexión: no se ha podido guardar. Inténtalo cuando vuelva internet.', 'error');
  } else {
    console.error(error);
    toast(`No se pudo guardar: ${error.message}`, 'error');
  }
}

// ---------- Cargar un script externo bajo demanda ----------
// Se usa para Supabase y Tesseract: si no hay internet, la promesa
// falla pero la web sigue funcionando.
export function cargarScript(url) {
  return new Promise((resolver, rechazar) => {
    const existente = document.querySelector(`script[src="${url}"]`);
    if (existente) existente.remove(); // si un intento anterior falló, lo quitamos
    const s = document.createElement('script');
    s.src = url;
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => { s.remove(); rechazar(new ErrorConexion(`No se pudo cargar ${url}`)); };
    document.head.appendChild(s);
  });
}

// ---------- localStorage "a prueba de fallos" ----------
// En modo privado de algunos navegadores localStorage lanza errores.
export function leerLS(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
export function escribirLS(clave, valor) {
  try {
    if (valor === null || valor === undefined) localStorage.removeItem(clave);
    else localStorage.setItem(clave, valor);
  } catch { /* sin almacenamiento: no pasa nada */ }
}

/** Genera un identificador único (para eventos en modo local) */
export function nuevoId() {
  if (window.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
