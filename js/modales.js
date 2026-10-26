// =============================================================
// modales.js — Ventanas del DÍA (turnos a mano) y del EVENTO
// =============================================================

import {
  turnoCompleto, horariosUsados, eventosDe, guardarTurno, guardarEvento, borrarEvento, datos,
} from './store.js';
import {
  TURNOS, CODIGOS_FIJOS, textoHoras, crearTurno, mismoTurno, nombreTurno, etiquetaLarga,
} from './turnos.js';
import { htmlEvento } from './calendario.js';
import { fechaLarga, hoyISO, toast, avisarError } from './utils.js';

// Emojis disponibles (el perro 🐶 y el arma 🔫 van los primeros)
const EMOJIS = ['🐶', '🔫', '📅', '❤️', '🎉', '🎂', '🎁', '🍽️', '🍕', '🍻', '☕', '🍿',
  '🎬', '🎮', '🎵', '🎤', '⚽', '🏋️', '🚴', '🏖️', '✈️', '🧳', '🚗', '🏠',
  '🛒', '💼', '📚', '🏥', '💊', '💇', '🧹', '🐱', '🌳', '⛰️', '💍', '⭐', '🔥', '💤'];

let alCambiar = () => {}; // función que redibuja el calendario (la pasa app.js)

// Atajo para buscar elementos
const $ = s => document.querySelector(s);

// =============================================================
// MODAL DEL DÍA
// =============================================================
const dlgDia = $('#dlg-dia');
let diaActual = null;                          // fecha ISO abierta
let seleccion = { dani: null, eva: null };     // turnos elegidos (aún sin guardar)

/** Abre el modal de un día con los turnos actuales y sus eventos */
export function abrirDia(iso) {
  diaActual = iso;
  seleccion = { dani: turnoCompleto('dani', iso), eva: turnoCompleto('eva', iso) };
  $('#dia-titulo').textContent = fechaLarga(iso);
  pintarSelectores();
  pintarEventosDia();
  if (!dlgDia.open) dlgDia.showModal();
}

/**
 * Botones M, T, N, FM, FT, FN, L, V, "🕒 Horas" y "Quitar" para cada persona.
 * Con "Horas" aparecen dos campos de hora y los horarios ya usados antes.
 */
function pintarSelectores() {
  for (const persona of ['dani', 'eva']) {
    const actual = seleccion[persona];
    const codigo = actual?.codigo || '';
    const botones = CODIGOS_FIJOS.map(c => `<button type="button"
        class="opcion${codigo === c ? ' opcion--activa' : ''}" data-codigo="${c}"
        aria-pressed="${codigo === c}" title="${TURNOS[c].nombre} ${textoHoras(c)}">${c}</button>`).join('');
    document.querySelector(`.selector-turno[data-persona="${persona}"]`).innerHTML = botones
      + `<button type="button" class="opcion opcion--horas${codigo === 'H' ? ' opcion--activa' : ''}" data-codigo="H"
          aria-pressed="${codigo === 'H'}">🕒 Horas</button>`
      + `<button type="button" class="opcion opcion--borrar" data-codigo="" aria-pressed="${!actual}">Quitar</button>`;
    $(`#dia-horas-${persona}`).textContent = actual
      ? `${nombreTurno(actual)}${actual.codigo === 'L' || actual.codigo === 'V' ? '' : ' · ' + etiquetaLarga(actual)}`
      : 'Sin turno';
    pintarHorasMedida(persona);
  }
}

/** Campos "entra / sale" + atajos con los horarios a medida ya usados */
function pintarHorasMedida(persona) {
  const caja = document.querySelector(`.horas-medida[data-persona="${persona}"]`);
  const actual = seleccion[persona];
  caja.hidden = actual?.codigo !== 'H';
  if (caja.hidden) return;
  const atajos = horariosUsados(persona).map(h => `<button type="button" class="atajo-hora"
      data-inicio="${h.inicio}" data-fin="${h.fin}">${etiquetaLarga(h)}</button>`).join('');
  caja.innerHTML = `
    <div class="fila-2">
      <label class="campo">Entra <input type="time" data-campo="inicio" value="${actual.inicio || ''}"></label>
      <label class="campo">Sale <input type="time" data-campo="fin" value="${actual.fin || ''}"></label>
    </div>
    ${atajos ? `<div class="atajos-horas">${atajos}</div>` : ''}`;
}

function pintarEventosDia() {
  const eventos = eventosDe(diaActual);
  $('#dia-eventos').innerHTML = eventos.length
    ? eventos.map(e => htmlEvento(e, true)).join('')
    : '<p class="vacio">No hay eventos este día.</p>';
}

/** Guarda solo los turnos que han cambiado */
async function guardarTurnosDia() {
  const boton = $('#dia-guardar');
  // Un horario a medida necesita las dos horas
  for (const persona of ['dani', 'eva']) {
    const t = seleccion[persona];
    if (t?.codigo === 'H' && (!t.inicio || !t.fin)) {
      toast(`Pon la hora de entrada y de salida de ${persona === 'dani' ? 'Dani' : 'Eva'}`, 'error');
      return;
    }
  }
  boton.disabled = true;
  try {
    let cambios = 0;
    for (const persona of ['dani', 'eva']) {
      if (!mismoTurno(seleccion[persona], turnoCompleto(persona, diaActual))) {
        await guardarTurno(persona, diaActual, seleccion[persona]);
        cambios++;
      }
    }
    dlgDia.close();
    alCambiar();
    if (cambios) toast('✅ Turnos guardados', 'ok');
  } catch (e) {
    avisarError(e);
  } finally {
    boton.disabled = false;
  }
}

// =============================================================
// MODAL DEL EVENTO (crear / ver / editar / borrar)
// =============================================================
const dlgEvento = $('#dlg-evento');
const form = $('#form-evento');
let eventoEditando = null; // null = evento nuevo
let emojiElegido = '📅';

/** Abre el formulario. Sin evento → nuevo (en la fecha indicada) */
export function abrirEvento(evento = null, fechaISO = hoyISO()) {
  form.reset();
  eventoEditando = evento;
  $('#evento-error').textContent = '';
  $('#evento-titulo-modal').textContent = evento ? 'Editar evento' : 'Nuevo evento';
  $('#evento-borrar').hidden = !evento;

  const campos = form.elements;
  campos.titulo.value = evento?.titulo || '';
  campos.fecha.value = evento?.fecha || fechaISO;
  campos.todo_el_dia.checked = evento ? evento.todo_el_dia : false;
  campos.hora_inicio.value = evento?.hora_inicio || '';
  campos.hora_fin.value = evento?.hora_fin || '';
  campos.notas.value = evento?.notas || '';
  form.querySelector(`input[name="quien"][value="${evento?.quien || 'ambos'}"]`).checked = true;

  emojiElegido = evento?.emoji || '📅';
  $('#evento-emoji-otro').value = EMOJIS.includes(emojiElegido) ? '' : emojiElegido;
  pintarEmojis();
  actualizarHoras();
  dlgEvento.showModal();
  if (!evento) campos.titulo.focus();
}

function pintarEmojis() {
  $('#selector-emojis').innerHTML = EMOJIS.map(e =>
    `<button type="button" role="option" data-emoji="${e}" aria-selected="${e === emojiElegido}">${e}</button>`).join('');
  $('#evento-emoji-actual').textContent = emojiElegido;
}

/** Si es "todo el día" se ocultan las horas */
function actualizarHoras() {
  $('#evento-horas').hidden = form.elements.todo_el_dia.checked;
}

async function enviarEvento(ev) {
  ev.preventDefault();
  const c = form.elements;
  const error = $('#evento-error');
  const titulo = c.titulo.value.trim();

  // Validaciones sencillas
  if (!titulo) { error.textContent = 'Pon un título.'; c.titulo.focus(); return; }
  if (!c.fecha.value) { error.textContent = 'Elige una fecha.'; return; }
  if (!c.todo_el_dia.checked && !c.hora_inicio.value) {
    error.textContent = 'Pon la hora de inicio o marca "Todo el día".';
    return;
  }
  error.textContent = '';

  const boton = $('#evento-guardar');
  boton.disabled = true;
  try {
    await guardarEvento({
      id: eventoEditando?.id,
      titulo,
      emoji: emojiElegido,
      fecha: c.fecha.value,
      todo_el_dia: c.todo_el_dia.checked,
      hora_inicio: c.hora_inicio.value,
      hora_fin: c.hora_fin.value,
      notas: c.notas.value.trim(),
      quien: c.quien.value,
    });
    dlgEvento.close();
    toast(eventoEditando ? '✅ Evento actualizado' : '✅ Evento añadido', 'ok');
    refrescarTrasCambio();
  } catch (e) {
    avisarError(e);
  } finally {
    boton.disabled = false;
  }
}

async function borrarEventoActual() {
  if (!eventoEditando) return;
  if (!confirm(`¿Borrar "${eventoEditando.titulo}"?`)) return;
  try {
    await borrarEvento(eventoEditando.id);
    dlgEvento.close();
    toast('🗑️ Evento borrado', 'ok');
    refrescarTrasCambio();
  } catch (e) {
    avisarError(e);
  }
}

/** Redibuja el calendario y, si el modal del día está abierto, su lista */
function refrescarTrasCambio() {
  alCambiar();
  if (dlgDia.open) pintarEventosDia();
}

/** Abre un evento a partir de su id (lo usan los clics del calendario) */
export function abrirEventoPorId(id) {
  const evento = datos.eventos.get(id);
  if (evento) abrirEvento(evento);
}

// =============================================================
// Conexión de los botones (se llama una vez desde app.js)
// =============================================================
export function iniciarModales(opciones) {
  alCambiar = opciones.alCambiar;

  // Elegir turno en el modal del día (delegación: un solo listener)
  dlgDia.addEventListener('click', e => {
    const boton = e.target.closest('.selector-turno button[data-codigo]');
    if (boton) {
      const persona = boton.parentElement.dataset.persona;
      const codigo = boton.dataset.codigo;
      if (!codigo) seleccion[persona] = null;
      else if (codigo === 'H') {
        // Si ya era un horario a medida lo mantenemos; si no, propone el más usado
        const previo = seleccion[persona]?.codigo === 'H' ? seleccion[persona] : horariosUsados(persona)[0];
        seleccion[persona] = crearTurno('H', previo?.inicio || '', previo?.fin || '');
      } else seleccion[persona] = crearTurno(codigo);
      pintarSelectores();
      return;
    }
    const atajo = e.target.closest('.atajo-hora');
    if (atajo) {
      const persona = atajo.closest('.horas-medida').dataset.persona;
      seleccion[persona] = crearTurno('H', atajo.dataset.inicio, atajo.dataset.fin);
      pintarSelectores();
      return;
    }
    const tarjeta = e.target.closest('[data-evento]');
    if (tarjeta) abrirEventoPorId(tarjeta.dataset.evento);
  });
  // Escribir las horas a medida (sin redibujar, para no perder el foco)
  dlgDia.addEventListener('input', e => {
    const campo = e.target.dataset.campo;
    if (!campo) return;
    const persona = e.target.closest('.horas-medida').dataset.persona;
    seleccion[persona] = { ...seleccion[persona], [campo]: e.target.value };
    $(`#dia-horas-${persona}`).textContent = `Horario · ${etiquetaLarga(seleccion[persona])}`;
  });
  $('#dia-guardar').addEventListener('click', guardarTurnosDia);
  $('#dia-nuevo-evento').addEventListener('click', () => abrirEvento(null, diaActual));

  // Formulario del evento
  form.addEventListener('submit', enviarEvento);
  form.elements.todo_el_dia.addEventListener('change', actualizarHoras);
  $('#evento-borrar').addEventListener('click', borrarEventoActual);
  $('#selector-emojis').addEventListener('click', e => {
    const b = e.target.closest('[data-emoji]');
    if (!b) return;
    emojiElegido = b.dataset.emoji;
    $('#evento-emoji-otro').value = '';
    pintarEmojis();
  });
  $('#evento-emoji-otro').addEventListener('input', e => {
    const valor = e.target.value.trim();
    emojiElegido = valor || '📅';
    pintarEmojis();
  });
}
