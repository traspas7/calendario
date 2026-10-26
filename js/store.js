// =============================================================
// store.js — Capa de datos
// -------------------------------------------------------------
// Aquí está todo lo que habla con Supabase y con la caché local.
// El resto de la app solo usa estas funciones y no sabe nada de
// la base de datos.
//
// Dos modos:
//   · "nube":  datos en Supabase (compartidos entre los dos móviles)
//              + copia en localStorage para verlos sin conexión.
//   · "local": si config.js no tiene claves, todo vive solo en este
//              navegador (sirve para probar).
// =============================================================

import { CONFIG } from './config.js';
import { cargarScript, ErrorConexion, leerLS, escribirLS, nuevoId } from './utils.js';

// Librería oficial de Supabase (versión fija para que nada cambie solo)
const URL_SUPABASE_JS = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const CLAVE_PIN = 'calendario.pin';
const ESPERA_MAX_MS = 15000; // si una petición tarda más de 15 s la damos por fallida

// ---------- Datos en memoria ----------
// turnos:  Map "persona|AAAA-MM-DD" → "M" / "T" / …
// eventos: Map id → { id, titulo, emoji, fecha, todo_el_dia, hora_inicio, hora_fin, notas, quien }
export const datos = { turnos: new Map(), eventos: new Map() };

// Estado de la conexión (lo lee app.js para pintar el indicador y el aviso)
export const estado = { modo: 'local', conectado: navigator.onLine, ultimaSync: null };

let cliente = null; // cliente de Supabase (se crea al conocer el PIN)

/** ¿Hay claves de Supabase en config.js? */
export function hayNube() {
  return Boolean(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
}

// La caché de la nube y los datos del modo local van en claves distintas
// para que nunca se mezclen.
const claveCache = () => (hayNube() ? 'calendario.cache.nube.v1' : 'calendario.datos.local.v1');

// ---------- PIN guardado en el dispositivo ----------
export const leerPin = () => leerLS(CLAVE_PIN);
export const guardarPin = pin => escribirLS(CLAVE_PIN, pin);
export function olvidarPin() {
  escribirLS(CLAVE_PIN, null);
  cliente = null;
}

// ---------- Avisar a la app de cambios de conexión ----------
function marcarConexion(ok) {
  if (estado.conectado !== ok) {
    estado.conectado = ok;
    window.dispatchEvent(new CustomEvent('calendario:estado'));
  }
}
export function forzarSinConexion() { marcarConexion(false); }

// ---------- Caché en localStorage ----------
export function cargarCache() {
  const texto = leerLS(claveCache());
  if (!texto) return false;
  try {
    const c = JSON.parse(texto);
    datos.turnos = new Map(c.turnos || []);
    datos.eventos = new Map((c.eventos || []).map(e => [e.id, e]));
    estado.ultimaSync = c.ultimaSync || null;
    return true;
  } catch {
    return false; // caché corrupta: la ignoramos
  }
}

function guardarCache() {
  escribirLS(claveCache(), JSON.stringify({
    turnos: [...datos.turnos],
    eventos: [...datos.eventos.values()],
    ultimaSync: estado.ultimaSync,
  }));
}

// ---------- Conexión con Supabase ----------

/** fetch con límite de tiempo: en conexiones muy malas no se queda colgado */
async function fetchConLimite(url, opciones = {}) {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), ESPERA_MAX_MS);
  try {
    return await fetch(url, { ...opciones, signal: control.signal });
  } finally {
    clearTimeout(temporizador);
  }
}

/**
 * Crea el cliente de Supabase. El PIN viaja en cada petición en la
 * cabecera "x-calendario-pin" y las políticas RLS de la base de datos
 * lo comprueban (ver supabase/schema.sql).
 */
export async function conectar(pin) {
  if (!window.supabase?.createClient) {
    try {
      await cargarScript(URL_SUPABASE_JS);
    } catch {
      marcarConexion(false);
      throw new ErrorConexion('No se pudo cargar la librería de Supabase');
    }
  }
  cliente = window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-calendario-pin': pin }, fetch: fetchConLimite },
  });
  estado.modo = 'nube';
}

async function obtenerCliente() {
  if (!cliente) {
    const pin = leerPin();
    if (!pin) throw new Error('Falta el PIN');
    await conectar(pin);
  }
  return cliente;
}

/** ¿El error es por falta de red (y no por un fallo de datos)? */
function esErrorDeRed(error) {
  const texto = String(error?.message || error || '');
  return !navigator.onLine || error?.name === 'AbortError'
    || /failed to fetch|networkerror|network request failed|load failed|aborted|fetch/i.test(texto);
}

/** Traduce los errores más típicos de Supabase a algo entendible */
function traducirError(error) {
  if (error.code === '42501') return 'PIN incorrecto o sin permiso (revisa las políticas RLS)';
  if (error.code === '42P01' || error.code === 'PGRST205') return 'No existen las tablas: ejecuta supabase/schema.sql';
  if (error.code === 'PGRST202') return 'Falta la función pin_valido: ejecuta supabase/schema.sql';
  return error.message || 'Error desconocido';
}

/**
 * Ejecuta una consulta de Supabase y unifica la gestión de errores:
 * - sin red → lanza ErrorConexion y marca "sin conexión"
 * - otro error → lanza Error con un mensaje en español
 * - todo bien → devuelve los datos y marca "conectado"
 */
async function ejecutar(crearConsulta) {
  const c = await obtenerCliente();
  let respuesta;
  try {
    respuesta = await crearConsulta(c);
  } catch (e) {
    if (esErrorDeRed(e)) { marcarConexion(false); throw new ErrorConexion(); }
    throw e;
  }
  if (respuesta.error) {
    if (esErrorDeRed(respuesta.error)) { marcarConexion(false); throw new ErrorConexion(); }
    throw new Error(traducirError(respuesta.error));
  }
  marcarConexion(true);
  return respuesta.data;
}

/** Comprueba en el servidor si el PIN es correcto (devuelve true/false) */
export async function comprobarPin(pin) {
  await conectar(pin);
  const resultado = await ejecutar(c => c.rpc('pin_valido'));
  return resultado === true;
}

// ---------- Lectura ----------

/** Deja las horas en "HH:MM" (Postgres devuelve "HH:MM:SS") */
function normalizarEvento(e) {
  return {
    id: e.id,
    titulo: e.titulo,
    emoji: e.emoji || '📅',
    fecha: e.fecha,
    todo_el_dia: Boolean(e.todo_el_dia),
    hora_inicio: e.hora_inicio ? e.hora_inicio.slice(0, 5) : null,
    hora_fin: e.hora_fin ? e.hora_fin.slice(0, 5) : null,
    notas: e.notas || '',
    quien: e.quien,
  };
}

/**
 * Descarga de Supabase los turnos y eventos entre dos fechas
 * (incluidas) y sustituye lo que había en memoria para ese rango.
 * Así también se reflejan los borrados que haya hecho el otro.
 */
export async function cargarRango(desde, hasta) {
  if (estado.modo !== 'nube') return;
  const [turnos, eventos] = await Promise.all([
    ejecutar(c => c.from('turnos').select('persona,fecha,codigo').gte('fecha', desde).lte('fecha', hasta)),
    ejecutar(c => c.from('eventos').select('*').gte('fecha', desde).lte('fecha', hasta).order('fecha')),
  ]);

  // Quitamos lo antiguo del rango…
  for (const clave of datos.turnos.keys()) {
    const fecha = clave.split('|')[1];
    if (fecha >= desde && fecha <= hasta) datos.turnos.delete(clave);
  }
  for (const [id, e] of datos.eventos) {
    if (e.fecha >= desde && e.fecha <= hasta) datos.eventos.delete(id);
  }
  // …y metemos lo nuevo
  turnos.forEach(t => datos.turnos.set(`${t.persona}|${t.fecha}`, t.codigo));
  eventos.forEach(e => datos.eventos.set(e.id, normalizarEvento(e)));

  estado.ultimaSync = new Date().toISOString();
  guardarCache();
}

/** Turno de una persona en una fecha ("M", "L", … o null) */
export const turnoDe = (persona, fecha) => datos.turnos.get(`${persona}|${fecha}`) || null;

/** ¿Tiene esa persona algún turno puesto en ese mes? (prefijo "AAAA-MM") */
export function tieneTurnosEnMes(persona, prefijoMes) {
  const inicio = `${persona}|${prefijoMes}`;
  for (const clave of datos.turnos.keys()) if (clave.startsWith(inicio)) return true;
  return false;
}

/** Eventos de una fecha, ordenados: primero los de todo el día, luego por hora */
export function eventosDe(fecha) {
  return [...datos.eventos.values()]
    .filter(e => e.fecha === fecha)
    .sort((a, b) => {
      if (a.todo_el_dia !== b.todo_el_dia) return a.todo_el_dia ? -1 : 1;
      return (a.hora_inicio || '').localeCompare(b.hora_inicio || '');
    });
}

// ---------- Escritura: turnos ----------

/** Pone, cambia o quita (codigo = null) el turno de un día */
export async function guardarTurno(persona, fecha, codigo) {
  if (estado.modo === 'nube') {
    if (codigo) {
      await ejecutar(c => c.from('turnos').upsert({ persona, fecha, codigo }, { onConflict: 'persona,fecha' }));
    } else {
      await ejecutar(c => c.from('turnos').delete().eq('persona', persona).eq('fecha', fecha));
    }
  }
  if (codigo) datos.turnos.set(`${persona}|${fecha}`, codigo);
  else datos.turnos.delete(`${persona}|${fecha}`);
  guardarCache();
}

/** Guarda muchos turnos de golpe (lo usa el importador de fotos) */
export async function guardarTurnos(persona, lista) {
  if (!lista.length) return;
  if (estado.modo === 'nube') {
    const filas = lista.map(({ fecha, codigo }) => ({ persona, fecha, codigo }));
    await ejecutar(c => c.from('turnos').upsert(filas, { onConflict: 'persona,fecha' }));
  }
  lista.forEach(({ fecha, codigo }) => datos.turnos.set(`${persona}|${fecha}`, codigo));
  guardarCache();
}

// ---------- Escritura: eventos ----------

/** Crea (sin id) o actualiza (con id) un evento. Devuelve el evento guardado */
export async function guardarEvento(evento) {
  const fila = {
    titulo: evento.titulo,
    emoji: evento.emoji,
    fecha: evento.fecha,
    todo_el_dia: evento.todo_el_dia,
    hora_inicio: evento.todo_el_dia ? null : evento.hora_inicio || null,
    hora_fin: evento.todo_el_dia ? null : evento.hora_fin || null,
    notas: evento.notas || null,
    quien: evento.quien,
  };
  let guardado;
  if (estado.modo === 'nube') {
    const data = evento.id
      ? await ejecutar(c => c.from('eventos').update(fila).eq('id', evento.id).select().single())
      : await ejecutar(c => c.from('eventos').insert(fila).select().single());
    guardado = normalizarEvento(data);
  } else {
    guardado = normalizarEvento({ ...fila, id: evento.id || nuevoId() });
  }
  datos.eventos.set(guardado.id, guardado);
  guardarCache();
  return guardado;
}

export async function borrarEvento(id) {
  if (estado.modo === 'nube') {
    await ejecutar(c => c.from('eventos').delete().eq('id', id));
  }
  datos.eventos.delete(id);
  guardarCache();
}
