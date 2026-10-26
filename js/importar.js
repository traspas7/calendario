// =============================================================
// importar.js — Pantalla "Subir foto de horario"
// -------------------------------------------------------------
// Paso 1: persona + mes + año + foto → mejora y vista previa
// Paso 2: tabla editable con los turnos leídos → confirmar y guardar
// =============================================================

import { CONFIG } from './config.js';
import { CODIGOS, PERSONAS } from './turnos.js';
import { turnoDe, guardarTurnos } from './store.js';
import { preprocesar, reconocer, dividirLineas, buscarFila, extraerCodigos } from './ocr.js';
import {
  MESES, DIAS_CORTOS, aISO, diaSemana, diasEnMes, capitalizar, escaparHTML,
  toast, avisarError, leerLS, escribirLS,
} from './utils.js';

const $ = s => document.querySelector(s);
const dlg = $('#dlg-foto');

// Estado de la importación en curso
const est = {
  imagen: null,       // <img> original
  urlImagen: null,    // URL temporal de la foto
  lienzo: null,       // canvas mejorado (lo que lee el OCR)
  texto: '',          // texto completo reconocido
  lineas: [],         // texto dividido en líneas
  indice: -1,         // línea usada como fila de la persona
  codigos: [],        // turnos por día (editable)
  persona: 'dani', anio: 2026, mes: 0, nombre: '',
};

let opciones = { alCambiar: () => {}, fechaVisible: () => new Date() };

// ---------- Utilidades de la pantalla ----------
const personaElegida = () => dlg.querySelector('input[name="foto-persona"]:checked').value;

/** Nombre en la planilla: el último usado en este móvil o el de config.js */
function nombreGuardado(persona) {
  return leerLS(`calendario.nombre.${persona}`) || CONFIG.NOMBRES_PLANILLA[persona] || '';
}

function mostrarPaso(n) {
  $('#foto-paso1').hidden = n !== 1;
  $('#foto-paso2').hidden = n !== 2;
}

function progreso(mensaje, valor) {
  const caja = $('#foto-progreso');
  caja.hidden = false;
  caja.querySelector('p').textContent = mensaje;
  caja.querySelector('span').style.width = `${Math.round((valor || 0) * 100)}%`;
}

// ---------- Abrir ----------
export function abrirImportar() {
  const f = opciones.fechaVisible();
  $('#foto-mes').value = String(f.getMonth());
  $('#foto-anio').value = f.getFullYear();
  $('#foto-nombre').value = nombreGuardado(personaElegida());
  $('#foto-progreso').hidden = true;
  mostrarPaso(1);
  dlg.showModal();
}

// ---------- Paso 1: cargar y mejorar la foto ----------
async function alElegirArchivo(e) {
  const archivo = e.target.files?.[0];
  if (!archivo) return;
  if (est.urlImagen) URL.revokeObjectURL(est.urlImagen);
  est.urlImagen = URL.createObjectURL(archivo);
  const img = new Image();
  img.src = est.urlImagen;
  try {
    await img.decode();
  } catch {
    toast('No se pudo abrir la imagen', 'error');
    return;
  }
  est.imagen = img;
  actualizarVistaPrevia();
}

/** Aplica la mejora y la muestra (se repite si cambia la casilla de B/N) */
function actualizarVistaPrevia() {
  if (!est.imagen) return;
  progreso('Mejorando la imagen…', 0.05);
  // setTimeout deja que el navegador pinte el mensaje antes del cálculo pesado
  setTimeout(() => {
    est.lienzo = preprocesar(est.imagen, $('#foto-binarizar').checked);
    const vista = $('#foto-preview');
    vista.width = est.lienzo.width;
    vista.height = est.lienzo.height;
    vista.getContext('2d').drawImage(est.lienzo, 0, 0);
    vista.hidden = false;
    $('#foto-leer').disabled = false;
    progreso('Imagen lista. Pulsa "Leer horario".', 0);
  }, 30);
}

async function leerHorario() {
  if (!est.lienzo) return;
  est.persona = personaElegida();
  est.mes = Number($('#foto-mes').value);
  est.anio = Number($('#foto-anio').value);
  est.nombre = $('#foto-nombre').value.trim();
  if (!est.anio || est.anio < 2000) { toast('Revisa el año', 'error'); return; }
  if (!est.nombre) { toast('Escribe el nombre tal y como sale en la planilla', 'error'); return; }
  escribirLS(`calendario.nombre.${est.persona}`, est.nombre);

  const boton = $('#foto-leer');
  boton.disabled = true;
  try {
    est.texto = await reconocer(est.lienzo, progreso);
    est.lineas = dividirLineas(est.texto);
    est.indice = buscarFila(est.lineas, est.nombre);
    rellenarSelectorLineas();
    aplicarFila();
    $('#foto-texto').textContent = est.texto || '(no se ha reconocido texto)';
    mostrarPaso(2);
  } catch (e) {
    console.error(e);
    toast(navigator.onLine
      ? `No se pudo leer la foto: ${e.message}`
      : '📴 Hace falta internet para descargar el lector la primera vez', 'error');
  } finally {
    boton.disabled = false;
    $('#foto-progreso').hidden = true;
  }
}

// ---------- Paso 2: revisar y corregir ----------

/** Desplegable con todas las líneas, por si el nombre no se detectó bien */
function rellenarSelectorLineas() {
  const opcionesHTML = est.lineas.map((l, i) =>
    `<option value="${i}">${escaparHTML(l.length > 70 ? l.slice(0, 70) + '…' : l)}</option>`);
  $('#foto-linea').innerHTML = '<option value="-1">— Ninguna (rellenar a mano) —</option>' + opcionesHTML.join('');
  $('#foto-linea').value = String(est.indice);
}

/** Extrae los códigos de la fila elegida y pinta la tabla */
function aplicarFila() {
  const dias = diasEnMes(est.anio, est.mes);
  est.codigos = est.indice >= 0
    ? extraerCodigos(est.lineas, est.indice, est.nombre, dias)
    : Array(dias).fill('');
  const leidos = est.codigos.filter(Boolean).length;
  const quien = PERSONAS[est.persona].nombre;
  const periodo = `${MESES[est.mes]} ${est.anio}`;

  $('#foto-resumen').innerHTML = est.indice < 0
    ? `⚠️ No he encontrado a «${escaparHTML(est.nombre)}» en la foto. Elige la fila abajo o rellena los turnos a mano.`
    : `Horario de <b>${quien}</b> para <b>${periodo}</b>: he leído <b>${leidos} de ${dias}</b> días. `
      + `Revisa cada día con la planilla (los marcados en naranja están vacíos) y corrige lo que haga falta.`;
  pintarTabla();
}

/** Tabla editable con forma de calendario (lunes primero) */
function pintarTabla() {
  const hueco = diaSemana(new Date(est.anio, est.mes, 1));
  let html = DIAS_CORTOS.map(d => `<span class="tabla-import__cab">${d}</span>`).join('');
  html += '<span></span>'.repeat(hueco);
  est.codigos.forEach((codigo, i) => {
    const fecha = aISO(new Date(est.anio, est.mes, i + 1));
    const actual = turnoDe(est.persona, fecha);
    const opcionesHTML = ['', ...CODIGOS].map(c =>
      `<option value="${c}"${c === codigo ? ' selected' : ''}>${c || '—'}</option>`).join('');
    html += `<label class="celda-import${codigo ? '' : ' celda-import--vacia'}">
      <span>${i + 1}</span>
      <select data-i="${i}" aria-label="Día ${i + 1}">${opcionesHTML}</select>
      ${actual && actual !== codigo ? `<small>antes ${actual}</small>` : ''}
    </label>`;
  });
  $('#foto-tabla').innerHTML = html;
}

async function confirmar() {
  const lista = est.codigos
    .map((codigo, i) => (codigo ? { fecha: aISO(new Date(est.anio, est.mes, i + 1)), codigo } : null))
    .filter(Boolean);
  if (!lista.length) { toast('No hay ningún turno que guardar', 'error'); return; }

  const boton = $('#foto-confirmar');
  boton.disabled = true;
  try {
    await guardarTurnos(est.persona, lista);
    dlg.close();
    toast(`✅ ${lista.length} turnos de ${PERSONAS[est.persona].nombre} añadidos a ${MESES[est.mes]}`, 'ok');
    opciones.alCambiar();
  } catch (e) {
    avisarError(e);
  } finally {
    boton.disabled = false;
  }
}

// ---------- Conexión de los controles (una vez, desde app.js) ----------
export function iniciarImportar(op) {
  opciones = op;
  $('#foto-mes').innerHTML = MESES.map((m, i) => `<option value="${i}">${capitalizar(m)}</option>`).join('');

  dlg.querySelectorAll('input[name="foto-persona"]').forEach(r =>
    r.addEventListener('change', () => { $('#foto-nombre').value = nombreGuardado(personaElegida()); }));
  $('#foto-archivo').addEventListener('change', alElegirArchivo);
  $('#foto-binarizar').addEventListener('change', actualizarVistaPrevia);
  $('#foto-leer').addEventListener('click', leerHorario);
  $('#foto-linea').addEventListener('change', e => { est.indice = Number(e.target.value); aplicarFila(); });
  $('#foto-tabla').addEventListener('change', e => {
    const sel = e.target.closest('select[data-i]');
    if (!sel) return;
    est.codigos[Number(sel.dataset.i)] = sel.value;
    sel.parentElement.classList.toggle('celda-import--vacia', !sel.value);
  });
  $('#foto-volver').addEventListener('click', () => mostrarPaso(1));
  $('#foto-confirmar').addEventListener('click', confirmar);
}
