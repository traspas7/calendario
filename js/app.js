// =============================================================
// app.js — Punto de entrada: arranque, PIN, navegación y sincronización
// =============================================================

import { CONFIG } from './config.js';
import * as store from './store.js';
import { renderVista, renderResumen, tituloPeriodo, rangoCarga } from './calendario.js';
import { iniciarModales, abrirDia, abrirEvento, abrirEventoPorId } from './modales.js';
import { iniciarImportar, abrirImportar } from './importar.js';
import { sumarDias, hoyISO, aISO, ErrorConexion, toast, leerLS, escribirLS } from './utils.js';

const $ = s => document.querySelector(s);

// Estado de la pantalla: qué vista y qué fecha se está mirando
const app = {
  vista: leerLS('calendario.vista') === 'semana' ? 'semana' : 'mes',
  fecha: new Date(),
};

// =============================================================
// DIBUJAR
// =============================================================
function render() {
  $('#titulo-periodo').textContent = tituloPeriodo(app.vista, app.fecha);
  renderVista(app.vista, app.fecha, $('#vista'));
  renderResumen(app.vista, app.fecha, $('#resumen'));
  document.querySelectorAll('[data-vista]').forEach(b => {
    const activo = b.dataset.vista === app.vista;
    b.classList.toggle('activo', activo);
    b.setAttribute('aria-pressed', activo);
  });
}

/** Indicador de arriba a la derecha + aviso de sin conexión / modo local */
function pintarEstado(sincronizando = false) {
  const el = $('#estado');
  const aviso = $('#aviso');
  let clase, texto;

  if (store.estado.modo === 'local') {
    clase = 'local'; texto = 'Modo local';
    aviso.className = 'aviso aviso--local';
    aviso.textContent = '⚠️ Modo local: los datos solo se guardan en este navegador. '
      + 'Rellena js/config.js con las claves de Supabase para compartirlos con Eva/Dani.';
    aviso.hidden = false;
  } else if (!store.estado.conectado) {
    clase = 'off'; texto = 'Sin conexión';
    const cuando = store.estado.ultimaSync
      ? new Date(store.estado.ultimaSync).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })
      : 'nunca';
    aviso.className = 'aviso';
    aviso.textContent = `📴 Sin conexión. Estás viendo los últimos datos guardados (${cuando}). `
      + 'Los cambios no se podrán guardar hasta que vuelva internet.';
    aviso.hidden = false;
  } else {
    clase = sincronizando ? 'sync' : 'ok';
    texto = sincronizando ? 'Sincronizando…' : 'Sincronizado';
    aviso.hidden = true;
  }
  el.className = `estado estado--${clase}`;
  el.querySelector('span').textContent = texto;
}

// =============================================================
// SINCRONIZACIÓN CON SUPABASE
// =============================================================
let pinVerificado = false;
let sincronizacionEnCurso = null; // evita lanzar dos a la vez

function sincronizar() {
  if (store.estado.modo !== 'nube') return Promise.resolve();
  if (sincronizacionEnCurso) return sincronizacionEnCurso;

  sincronizacionEnCurso = (async () => {
    pintarEstado(true);
    try {
      // Si arrancamos sin internet, el PIN guardado se comprueba al volver la conexión
      if (!pinVerificado) {
        const ok = await store.comprobarPin(store.leerPin() || '');
        if (!ok) {
          store.olvidarPin();
          await pedirPin('El PIN ha cambiado o no es correcto. Escríbelo de nuevo.');
        }
        pinVerificado = true;
      }
      const { desde, hasta } = rangoCarga(app.fecha);
      await store.cargarRango(desde, hasta);
      render();
    } catch (e) {
      if (!(e instanceof ErrorConexion)) {
        console.error(e);
        toast(`Error al cargar: ${e.message}`, 'error');
      }
    } finally {
      sincronizacionEnCurso = null;
      pintarEstado();
    }
  })();
  return sincronizacionEnCurso;
}

// =============================================================
// PIN (se pide la primera vez y queda guardado en el dispositivo)
// =============================================================
function pedirPin(mensaje = '') {
  return new Promise(resolver => {
    const dlg = $('#dlg-pin');
    const entrada = $('#pin-input');
    const error = $('#pin-error');
    const boton = $('#pin-entrar');
    error.textContent = mensaje;
    entrada.value = '';
    if (!dlg.open) dlg.showModal();
    entrada.focus();

    $('#form-pin').onsubmit = async ev => {
      ev.preventDefault();
      const pin = entrada.value.trim();
      if (!pin) return;
      // Las cabeceras HTTP solo admiten caracteres básicos (sin ñ ni tildes)
      if (!/^[\x21-\x7E]+$/.test(pin)) {
        error.textContent = 'Usa solo letras sin tilde/ñ, números o símbolos básicos, sin espacios.';
        return;
      }
      boton.disabled = true;
      error.textContent = 'Comprobando…';
      try {
        if (await store.comprobarPin(pin)) {
          store.guardarPin(pin);
          pinVerificado = true;
          dlg.close();
          resolver(pin);
        } else {
          error.textContent = '❌ PIN incorrecto';
          entrada.select();
        }
      } catch (e) {
        error.textContent = e instanceof ErrorConexion
          ? '📴 Sin conexión. Hace falta internet para entrar la primera vez.'
          : `Error: ${e.message}`;
      } finally {
        boton.disabled = false;
      }
    };
  });
}

// =============================================================
// NAVEGACIÓN
// =============================================================
function mover(direccion) {
  if (app.vista === 'mes') {
    app.fecha = new Date(app.fecha.getFullYear(), app.fecha.getMonth() + direccion, 1);
  } else {
    app.fecha = sumarDias(app.fecha, 7 * direccion);
  }
  render();
  sincronizar();
}

function irAHoy() {
  app.fecha = new Date();
  render();
  sincronizar();
}

function cambiarVista(vista) {
  if (vista === app.vista) return;
  // Al pasar a semana: si estamos en el mes actual, mostramos la semana de hoy
  const hoy = new Date();
  if (vista === 'semana' && app.fecha.getFullYear() === hoy.getFullYear() && app.fecha.getMonth() === hoy.getMonth()) {
    app.fecha = hoy;
  }
  app.vista = vista;
  escribirLS('calendario.vista', vista);
  render();
}

/** Para "Añadir evento": hoy si se está viendo este mes/semana; si no, el día 1 / lunes visible */
function fechaParaNuevoEvento() {
  const hoy = hoyISO();
  const visible = aISO(app.fecha);
  return visible.slice(0, 7) === hoy.slice(0, 7) && app.vista === 'mes' ? hoy : visible;
}

// =============================================================
// CONEXIÓN DE BOTONES Y GESTOS
// =============================================================
function conectarEventos() {
  $('#btn-anterior').addEventListener('click', () => mover(-1));
  $('#btn-siguiente').addEventListener('click', () => mover(1));
  $('#btn-hoy').addEventListener('click', irAHoy);
  document.querySelectorAll('[data-vista]').forEach(b =>
    b.addEventListener('click', () => cambiarVista(b.dataset.vista)));
  $('#btn-evento').addEventListener('click', () => abrirEvento(null, fechaParaNuevoEvento()));
  $('#btn-foto').addEventListener('click', abrirImportar);
  $('#btn-ajustes').addEventListener('click', abrirAjustes);

  // Clics dentro del calendario: un evento abre su edición; un día, su modal
  $('#vista').addEventListener('click', e => {
    const evento = e.target.closest('[data-evento]');
    if (evento) { abrirEventoPorId(evento.dataset.evento); return; }
    const dia = e.target.closest('[data-fecha]');
    if (dia) abrirDia(dia.dataset.fecha);
  });

  // Deslizar el dedo a izquierda/derecha cambia de mes/semana
  let inicioX = 0, inicioY = 0;
  $('#vista').addEventListener('touchstart', e => {
    inicioX = e.touches[0].clientX; inicioY = e.touches[0].clientY;
  }, { passive: true });
  $('#vista').addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - inicioX;
    const dy = e.changedTouches[0].clientY - inicioY;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 50) mover(dx < 0 ? 1 : -1);
  }, { passive: true });

  // Flechas del teclado (en ordenador), si no hay ninguna ventana abierta
  document.addEventListener('keydown', e => {
    if (document.querySelector('dialog[open]')) return;
    if (e.key === 'ArrowLeft') mover(-1);
    if (e.key === 'ArrowRight') mover(1);
  });

  // Cerrar modales: botones con data-cerrar o clic en el fondo oscuro
  document.querySelectorAll('dialog').forEach(dlg => {
    dlg.addEventListener('click', e => {
      if (e.target.closest('[data-cerrar]') || (e.target === dlg && dlg.id !== 'dlg-pin')) dlg.close();
    });
  });
  // El PIN no se puede cerrar con la tecla Esc
  $('#dlg-pin').addEventListener('cancel', e => e.preventDefault());

  // Conexión: avisos al perderla y recarga al recuperarla
  window.addEventListener('offline', () => { store.forzarSinConexion(); });
  window.addEventListener('online', () => sincronizar());
  window.addEventListener('calendario:estado', () => pintarEstado());

  // Al volver a la app (p. ej. desde otra app del móvil) buscamos cambios
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizar();
  });
}

// =============================================================
// AJUSTES
// =============================================================
function abrirAjustes() {
  const info = $('#ajustes-info');
  if (store.estado.modo === 'local') {
    info.textContent = 'Modo local: sin Supabase configurado. Los datos solo están en este navegador.';
  } else {
    const cuando = store.estado.ultimaSync
      ? new Date(store.estado.ultimaSync).toLocaleString('es-ES') : 'nunca';
    info.textContent = `Conectado a Supabase. Última sincronización: ${cuando}.`;
  }
  $('#ajustes-olvidar').hidden = store.estado.modo !== 'nube';
  $('#dlg-ajustes').showModal();
}

function conectarAjustes() {
  $('#ajustes-recargar').addEventListener('click', async () => {
    $('#dlg-ajustes').close();
    await sincronizar();
    toast(store.estado.conectado ? '🔄 Datos actualizados' : '📴 Sin conexión', store.estado.conectado ? 'ok' : 'error');
  });
  $('#ajustes-olvidar').addEventListener('click', () => {
    if (!confirm('¿Olvidar el PIN en este dispositivo? Tendrás que escribirlo de nuevo.')) return;
    store.olvidarPin();
    location.reload();
  });
}

// =============================================================
// SERVICE WORKER: permite abrir la web aunque no haya internet
// =============================================================
function registrarServiceWorker() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('Service worker no registrado', e));
  }
}

// =============================================================
// ARRANQUE
// =============================================================
async function iniciar() {
  registrarServiceWorker();
  conectarEventos();
  conectarAjustes();
  iniciarModales({ alCambiar: render });
  iniciarImportar({ alCambiar: render, fechaVisible: () => app.fecha });

  // 1) Pintamos enseguida con lo que haya guardado en el móvil
  store.estado.modo = store.hayNube() ? 'nube' : 'local';
  store.cargarCache();
  render();
  pintarEstado();

  // 2) Sin claves de Supabase → modo local y listo
  if (store.estado.modo === 'local') return;

  // 3) Con Supabase: pedimos el PIN si no está guardado y sincronizamos
  if (!store.leerPin()) await pedirPin();
  await sincronizar();

  // 4) Cada X segundos buscamos cambios del otro (solo si la app está a la vista)
  setInterval(() => {
    if (document.visibilityState === 'visible') sincronizar();
  }, CONFIG.REFRESCO_SEGUNDOS * 1000);
}

iniciar();
