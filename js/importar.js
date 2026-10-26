// =============================================================
// importar.js — Ventana "Cargar horario del mes"
// -------------------------------------------------------------
// Paso 1: de quién, qué mes y cómo:
//   📊 Archivo Excel · 📋 Pegar desde Excel · ✏️ A mano · 📷 Foto
// Paso 2: editor del mes. Se elige un turno en la "paleta" y se
//   tocan los días. Al guardar, el mes de esa persona queda igual
//   que en el editor (solo se envían los días que cambian).
// =============================================================

import { CONFIG } from './config.js';
import { CODIGOS_FIJOS, PERSONAS, crearTurno, mismoTurno, etiquetaCorta, etiquetaLarga, estaLibre } from './turnos.js';
import { turnoCompleto, horariosUsados, guardarTurnos, borrarTurnos } from './store.js';
import { preprocesar, reconocer, dividirLineas, buscarFila, extraerCodigos } from './ocr.js';
import { leerLibro, hojaATabla, textoATabla, elegirHoja, mesDeHoja, extraerDeTabla } from './excel.js';
import {
  MESES, DIAS_CORTOS, aISO, diaSemana, diasEnMes, capitalizar, escaparHTML,
  toast, avisarError, leerLS, escribirLS,
} from './utils.js';

const $ = s => document.querySelector(s);
const dlg = $('#dlg-importar');

// Estado de la carga en curso
const est = {
  persona: 'dani', anio: 2026, mes: 0, nombre: '',
  celdas: [],          // turno (o null) por cada día del mes: lo que se va a guardar
  pincel: null,        // turno elegido en la paleta, o 'borrar'
  horasExtra: [],      // horarios a medida añadidos en esta sesión
  libro: null,         // Excel abierto
  imagen: null, urlImagen: null, lienzo: null, // foto
  lineas: [], indice: -1,                      // texto de la foto
};

let opciones = { alCambiar: () => {}, fechaVisible: () => new Date() };

// =============================================================
// Utilidades de la pantalla
// =============================================================
const personaElegida = () => dlg.querySelector('input[name="imp-persona"]:checked').value;

/** Nombre en el cuadrante: el último usado en este móvil o el de config.js */
function nombreGuardado(persona) {
  return leerLS(`calendario.nombre.${persona}`) || CONFIG.NOMBRES_PLANILLA[persona] || '';
}

function mostrarPaso(n) {
  $('#imp-paso1').hidden = n !== 1;
  $('#imp-paso2').hidden = n !== 2;
  dlg.scrollTop = 0;
}

/** Muestra solo la caja del método elegido (y el nombre si hace falta) */
function mostrarMetodo(metodo) {
  $('#imp-excel-caja').hidden = metodo !== 'excel';
  $('#imp-pegar-caja').hidden = metodo !== 'pegar';
  $('#imp-foto-caja').hidden = metodo !== 'foto';
  $('#imp-nombre-caja').hidden = !['excel', 'pegar', 'foto'].includes(metodo);
  dlg.querySelectorAll('.metodo').forEach(m => m.classList.toggle('metodo--activo',
    m.dataset.metodo === metodo || (metodo === 'excel' && m.contains($('#imp-excel')))));
}

/** Lee persona, mes, año y nombre del paso 1. Devuelve false si falta algo */
function leerDatosPaso1(necesitaNombre) {
  est.persona = personaElegida();
  est.mes = Number($('#imp-mes').value);
  est.anio = Number($('#imp-anio').value);
  est.nombre = $('#imp-nombre').value.trim();
  if (!est.anio || est.anio < 2000) { toast('Revisa el año', 'error'); return false; }
  if (necesitaNombre && !est.nombre) {
    toast('Escribe el nombre tal y como sale en el cuadrante', 'error');
    $('#imp-nombre').focus();
    return false;
  }
  if (est.nombre) escribirLS(`calendario.nombre.${est.persona}`, est.nombre);
  return true;
}

const fechaDia = i => aISO(new Date(est.anio, est.mes, i + 1));
const turnosActuales = () =>
  Array.from({ length: diasEnMes(est.anio, est.mes) }, (_, i) => turnoCompleto(est.persona, fechaDia(i)));

// =============================================================
// Abrir
// =============================================================
export function abrirImportar() {
  const f = opciones.fechaVisible();
  $('#imp-mes').value = String(f.getMonth());
  $('#imp-anio').value = f.getFullYear();
  $('#imp-nombre').value = nombreGuardado(personaElegida());
  $('#imp-progreso').hidden = true;
  mostrarMetodo(null);
  mostrarPaso(1);
  dlg.showModal();
}

// =============================================================
// Método 1: archivo Excel
// =============================================================
async function alElegirExcel(e) {
  const archivo = e.target.files?.[0];
  e.target.value = ''; // permite volver a elegir el mismo archivo
  if (!archivo) return;
  mostrarMetodo('excel');
  try {
    toast('Abriendo el Excel…');
    est.libro = await leerLibro(archivo);
  } catch (err) {
    console.error(err);
    toast(navigator.onLine ? 'No se pudo abrir el archivo' : '📴 Hace falta internet para abrir Excel la primera vez', 'error');
    return;
  }
  const hojas = est.libro.SheetNames;
  $('#imp-hoja').innerHTML = hojas.map(h => `<option>${escaparHTML(h)}</option>`).join('');
  $('#imp-hoja').value = elegirHoja(est.libro, Number($('#imp-mes').value), Number($('#imp-anio').value));
  alCambiarHoja();
  if (!$('#imp-nombre').value) $('#imp-nombre').focus();
}

/** Al elegir una hoja tipo "NOV26" se ponen solos el mes y el año */
function alCambiarHoja() {
  const m = mesDeHoja($('#imp-hoja').value);
  if (m) {
    $('#imp-mes').value = String(m.mes);
    $('#imp-anio').value = m.anio;
  }
}

function leerExcel() {
  if (!est.libro || !leerDatosPaso1(true)) return;
  const tabla = hojaATabla(est.libro, $('#imp-hoja').value);
  procesarTabla(tabla, `hoja «${$('#imp-hoja').value}»`);
}

// =============================================================
// Método 2: pegar desde Excel
// =============================================================
function leerPegado() {
  if (!leerDatosPaso1(true)) return;
  const texto = $('#imp-pegar').value;
  if (!texto.trim()) { toast('Pega primero las filas copiadas de Excel', 'error'); return; }
  procesarTabla(textoATabla(texto), 'lo pegado');
}

/** Común a Excel y pegar: extrae los turnos y abre el editor */
function procesarTabla(tabla, origen) {
  const dias = diasEnMes(est.anio, est.mes);
  const r = extraerDeTabla(tabla, est.nombre, dias);
  if (r.error) { toast(r.error + ' Revisa el nombre.', 'error'); return; }

  est.celdas = r.celdas;
  const leidos = r.celdas.filter(Boolean).length;
  let resumen = `${r.aviso}He leído <b>${leidos} de ${dias}</b> días de ${origen} para `
    + `<b>${PERSONAS[est.persona].nombre}</b> en <b>${MESES[est.mes]} ${est.anio}</b>. Las celdas vacías cuentan como Libre.`;
  if (r.dudosos.length) {
    resumen += ` ⚠️ No he entendido: ${r.dudosos.map(escaparHTML).join(', ')} (marcados en naranja).`;
  }
  abrirEditor(resumen, { texto: r.textoFila });
}

// =============================================================
// Método 3: rellenar a mano (el editor con lo que ya hay)
// =============================================================
function rellenarAMano() {
  if (!leerDatosPaso1(false)) return;
  est.celdas = turnosActuales();
  abrirEditor(`Rellena el mes de <b>${PERSONAS[est.persona].nombre}</b> (${MESES[est.mes]} ${est.anio}): `
    + 'elige un turno arriba y toca los días. Para horas sueltas usa <b>＋ Horario</b>.');
}

// =============================================================
// Método 4: foto (OCR)
// =============================================================
async function alElegirFoto(e) {
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

function progreso(mensaje, valor) {
  const caja = $('#imp-progreso');
  caja.hidden = false;
  caja.querySelector('p').textContent = mensaje;
  caja.querySelector('span').style.width = `${Math.round((valor || 0) * 100)}%`;
}

/** Aplica la mejora de imagen y la muestra */
function actualizarVistaPrevia() {
  if (!est.imagen) return;
  progreso('Mejorando la imagen…', 0.05);
  // setTimeout deja que el navegador pinte el mensaje antes del cálculo pesado
  setTimeout(() => {
    est.lienzo = preprocesar(est.imagen, $('#imp-binarizar').checked);
    const vista = $('#imp-preview');
    vista.width = est.lienzo.width;
    vista.height = est.lienzo.height;
    vista.getContext('2d').drawImage(est.lienzo, 0, 0);
    vista.hidden = false;
    $('#imp-leer-foto').disabled = false;
    progreso('Imagen lista. Pulsa "Leer foto".', 0);
  }, 30);
}

async function leerFoto() {
  if (!est.lienzo || !leerDatosPaso1(true)) return;
  const boton = $('#imp-leer-foto');
  boton.disabled = true;
  try {
    const texto = await reconocer(est.lienzo, progreso);
    est.lineas = dividirLineas(texto);
    est.indice = buscarFila(est.lineas, est.nombre);
    $('#imp-linea').innerHTML = '<option value="-1">— Ninguna —</option>' + est.lineas.map((l, i) =>
      `<option value="${i}">${escaparHTML(l.length > 70 ? l.slice(0, 70) + '…' : l)}</option>`).join('');
    $('#imp-linea').value = String(est.indice);
    aplicarFilaFoto();
    abrirEditor(resumenFoto(), { texto, foto: true });
  } catch (e) {
    console.error(e);
    toast(navigator.onLine ? `No se pudo leer la foto: ${e.message}` : '📴 Hace falta internet la primera vez', 'error');
  } finally {
    boton.disabled = false;
    $('#imp-progreso').hidden = true;
  }
}

function aplicarFilaFoto() {
  const dias = diasEnMes(est.anio, est.mes);
  const codigos = est.indice >= 0 ? extraerCodigos(est.lineas, est.indice, est.nombre, dias) : Array(dias).fill('');
  est.celdas = codigos.map(c => (c ? crearTurno(c) : null));
}

function resumenFoto() {
  const dias = est.celdas.length;
  const leidos = est.celdas.filter(Boolean).length;
  return est.indice < 0
    ? `⚠️ No he encontrado a «${escaparHTML(est.nombre)}» en la foto. Elige la fila abajo o rellena a mano.`
    : `He leído <b>${leidos} de ${dias}</b> días de la foto. La foto no es fiable: compara cada día con el original.`;
}

// =============================================================
// Paso 2: editor del mes con paleta
// =============================================================
function abrirEditor(resumen, { texto = '', foto = false } = {}) {
  $('#imp-resumen').innerHTML = resumen;
  $('#imp-linea-caja').hidden = !foto;
  $('#imp-detalles').hidden = !texto;
  $('#imp-texto').textContent = texto;
  $('#imp-otro').hidden = true;
  est.horasExtra = [];
  est.pincel = crearTurno('L');
  pintarPaleta();
  pintarTabla();
  mostrarPaso(2);
}

/** Opciones de la paleta: códigos fijos + horarios a medida conocidos */
function opcionesPaleta() {
  const horas = [...horariosUsados(est.persona), ...est.horasExtra, ...est.celdas.filter(t => t?.codigo === 'H')];
  const unicas = [];
  for (const h of horas) if (!unicas.some(u => mismoTurno(u, h))) unicas.push(h);
  return [...CODIGOS_FIJOS.map(c => crearTurno(c)), ...unicas];
}

function pintarPaleta() {
  const opcionesHTML = opcionesPaleta().map((t, i) => {
    const activo = est.pincel !== 'borrar' && mismoTurno(est.pincel, t);
    return `<button type="button" class="pincel pincel--${est.persona}${activo ? ' pincel--activo' : ''}"
      data-i="${i}" aria-pressed="${activo}" title="${escaparHTML(etiquetaLarga(t))}">${t.codigo === 'H' ? etiquetaLarga(t) : t.codigo}</button>`;
  }).join('');
  $('#imp-paleta').innerHTML = opcionesHTML
    + `<button type="button" class="pincel pincel--accion" data-accion="otro">＋ Horario</button>`
    + `<button type="button" class="pincel pincel--accion${est.pincel === 'borrar' ? ' pincel--activo' : ''}" data-accion="borrar">🧽 Borrar</button>`;
}

/** Calendario del mes (lunes primero). Cada día es un botón */
function pintarTabla() {
  const hueco = diaSemana(new Date(est.anio, est.mes, 1));
  const actuales = turnosActuales();
  let html = DIAS_CORTOS.map(d => `<span class="tabla-import__cab">${d}</span>`).join('');
  html += '<span></span>'.repeat(hueco);
  est.celdas.forEach((t, i) => {
    const antes = actuales[i];
    const cambia = !mismoTurno(antes, t);
    const clases = ['celda-import'];
    if (!t) clases.push('celda-import--vacia');
    else clases.push(`celda-import--${est.persona}`, estaLibre(t.codigo) ? 'celda-import--libre' : 'celda-import--trabajo');
    html += `<button type="button" class="${clases.join(' ')}" data-dia="${i}"
        aria-label="Día ${i + 1}: ${t ? etiquetaLarga(t) : 'sin turno'}">
      <span>${i + 1}</span>
      <b>${t ? escaparHTML(etiquetaCorta(t)) : '—'}</b>
      ${cambia && antes ? `<small>antes ${escaparHTML(etiquetaCorta(antes))}</small>` : ''}
    </button>`;
  });
  $('#imp-tabla').innerHTML = html;
}

function alTocarPaleta(e) {
  const b = e.target.closest('.pincel');
  if (!b) return;
  if (b.dataset.accion === 'otro') {
    $('#imp-otro').hidden = false;
    $('#imp-otro-inicio').focus();
    return;
  }
  est.pincel = b.dataset.accion === 'borrar' ? 'borrar' : opcionesPaleta()[Number(b.dataset.i)];
  pintarPaleta();
}

function anadirHorario() {
  const inicio = $('#imp-otro-inicio').value;
  const fin = $('#imp-otro-fin').value;
  if (!inicio || !fin) { toast('Pon la hora de entrada y de salida', 'error'); return; }
  const turno = crearTurno('H', inicio, fin);
  est.horasExtra.push(turno);
  est.pincel = turno;
  $('#imp-otro').hidden = true;
  pintarPaleta();
  toast(`Ahora toca los días de ${etiquetaLarga(turno)}`);
}

function alTocarDia(e) {
  const celda = e.target.closest('[data-dia]');
  if (!celda || !est.pincel) return;
  const i = Number(celda.dataset.dia);
  est.celdas[i] = est.pincel === 'borrar' ? null : { ...est.pincel };
  pintarTabla();
}

function vaciosALibre() {
  est.celdas = est.celdas.map(t => t || crearTurno('L'));
  pintarTabla();
}

/** Guarda solo los días que han cambiado (y quita los que se han vaciado) */
async function confirmar() {
  const actuales = turnosActuales();
  const guardar = [];
  const quitar = [];
  est.celdas.forEach((t, i) => {
    if (mismoTurno(t, actuales[i])) return;
    if (t) guardar.push({ fecha: fechaDia(i), ...t });
    else quitar.push(fechaDia(i));
  });
  if (!guardar.length && !quitar.length) { toast('No hay cambios que guardar'); return; }
  if (quitar.length && !confirm(`Se quitará el turno de ${quitar.length} día(s) que se han quedado vacíos. ¿Seguir?`)) return;

  const boton = $('#imp-confirmar');
  boton.disabled = true;
  try {
    await guardarTurnos(est.persona, guardar);
    await borrarTurnos(est.persona, quitar);
    dlg.close();
    toast(`✅ ${PERSONAS[est.persona].nombre}: ${guardar.length + quitar.length} días actualizados en ${MESES[est.mes]}`, 'ok');
    opciones.alCambiar();
  } catch (e) {
    avisarError(e);
  } finally {
    boton.disabled = false;
  }
}

// =============================================================
// Conexión de los controles (una vez, desde app.js)
// =============================================================
export function iniciarImportar(op) {
  opciones = op;
  $('#imp-mes').innerHTML = MESES.map((m, i) => `<option value="${i}">${capitalizar(m)}</option>`).join('');

  dlg.querySelectorAll('input[name="imp-persona"]').forEach(r =>
    r.addEventListener('change', () => { $('#imp-nombre').value = nombreGuardado(personaElegida()); }));

  // Métodos
  $('#imp-excel').addEventListener('change', alElegirExcel);
  dlg.querySelectorAll('button.metodo').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.metodo === 'manual') rellenarAMano();
    else mostrarMetodo(b.dataset.metodo);
  }));
  $('#imp-hoja').addEventListener('change', alCambiarHoja);
  $('#imp-leer-excel').addEventListener('click', leerExcel);
  $('#imp-leer-pegado').addEventListener('click', leerPegado);
  $('#imp-foto').addEventListener('change', alElegirFoto);
  $('#imp-binarizar').addEventListener('change', actualizarVistaPrevia);
  $('#imp-leer-foto').addEventListener('click', leerFoto);
  $('#imp-linea').addEventListener('change', e => {
    est.indice = Number(e.target.value);
    aplicarFilaFoto();
    $('#imp-resumen').innerHTML = resumenFoto();
    pintarTabla();
  });

  // Editor
  $('#imp-paleta').addEventListener('click', alTocarPaleta);
  $('#imp-otro-anadir').addEventListener('click', anadirHorario);
  $('#imp-tabla').addEventListener('click', alTocarDia);
  $('#imp-vacios-libre').addEventListener('click', vaciosALibre);
  $('#imp-volver').addEventListener('click', () => mostrarPaso(1));
  $('#imp-confirmar').addEventListener('click', confirmar);
}
