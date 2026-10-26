// =============================================================
// calendario.js — Dibuja la vista de mes, la de semana y el resumen
// -------------------------------------------------------------
// Solo genera HTML a partir de los datos de store.js. Los clics
// se gestionan en app.js mediante los atributos data-fecha y
// data-evento ("delegación de eventos").
// =============================================================

import { turnoDe, turnoCompleto, eventosDe, tieneTurnosEnMes } from './store.js';
import {
  TURNOS, PERSONAS, textoHoras, trabaja, estaLibre, etiquetaCorta, etiquetaLarga, nombreTurno,
} from './turnos.js';
import {
  MESES, MESES_CORTOS, DIAS_CORTOS, DIAS_ABREV, aISO, deISO, sumarDias, diaSemana,
  inicioSemana, diasEnMes, hoyISO, capitalizar, fechaLarga, horaCorta, escaparHTML,
} from './utils.js';

// ---------- Cálculos de periodos ----------

/** Lista de fechas ISO que se ven en pantalla (mes completo o 7 días) */
export function diasVisibles(vista, fecha) {
  if (vista === 'semana') {
    const lunes = inicioSemana(fecha);
    return Array.from({ length: 7 }, (_, i) => aISO(sumarDias(lunes, i)));
  }
  const a = fecha.getFullYear(), m = fecha.getMonth();
  return Array.from({ length: diasEnMes(a, m) }, (_, i) => aISO(new Date(a, m, i + 1)));
}

/** Rango que se descarga de Supabase: del mes anterior al siguiente */
export function rangoCarga(fecha) {
  const a = fecha.getFullYear(), m = fecha.getMonth();
  return { desde: aISO(new Date(a, m - 1, 1)), hasta: aISO(new Date(a, m + 2, 0)) };
}

/** Texto de la barra superior: "Octubre 2026" o "26 oct – 1 nov 2026" */
export function tituloPeriodo(vista, fecha) {
  if (vista === 'mes') return `${capitalizar(MESES[fecha.getMonth()])} ${fecha.getFullYear()}`;
  const ini = inicioSemana(fecha), fin = sumarDias(ini, 6);
  const parteIni = ini.getMonth() === fin.getMonth()
    ? `${ini.getDate()}`
    : `${ini.getDate()} ${MESES_CORTOS[ini.getMonth()]}`;
  return `${parteIni} – ${fin.getDate()} ${MESES_CORTOS[fin.getMonth()]} ${fin.getFullYear()}`;
}

/**
 * ¿Libramos los dos ese día?
 * Solo se resalta si los dos tienen turnos puestos en ese mes; así un mes
 * vacío no sale lleno de corazones. Un día sin turno cuenta como libre.
 */
function crearComprobadorJuntos() {
  const memo = new Map(); // evita recorrer todos los turnos para cada día
  const tieneDatos = (persona, mes) => {
    const k = persona + mes;
    if (!memo.has(k)) memo.set(k, tieneTurnosEnMes(persona, mes));
    return memo.get(k);
  };
  return iso => {
    const mes = iso.slice(0, 7);
    if (!tieneDatos('dani', mes) || !tieneDatos('eva', mes)) return false;
    return estaLibre(turnoDe('dani', iso)) && estaLibre(turnoDe('eva', iso));
  };
}

// ---------- Piezas de HTML reutilizables ----------

/** Chip pequeño de la vista mes: la letra o las horas resumidas ("17-22") */
function chipMes(persona, turno) {
  if (!turno) return `<span class="chip chip--${persona} chip--vacio">·</span>`;
  const libre = estaLibre(turno.codigo) ? ' chip--libre' : '';
  const horas = turno.codigo === 'H' ? ' chip--horas' : '';
  return `<span class="chip chip--${persona}${libre}${horas}">${etiquetaCorta(turno)}</span>`;
}

/** Turno de la vista semana: letra + horas */
function turnoSemana(persona, turno, iso) {
  const nombre = PERSONAS[persona].nombre;
  if (!turno) {
    return `<button type="button" class="turno turno--${persona} turno--vacio" data-fecha="${iso}">
      <b>–</b><span>${nombre}: sin turno</span></button>`;
  }
  const libre = estaLibre(turno.codigo) ? ' turno--libre' : '';
  const letra = turno.codigo === 'H' ? '🕒' : turno.codigo;
  const detalle = etiquetaLarga(turno);
  return `<button type="button" class="turno turno--${persona}${libre}" data-fecha="${iso}"
      aria-label="${nombre}: ${nombreTurno(turno)} ${detalle}">
      <b>${letra}</b><span>${detalle}</span><small>${nombre}</small></button>`;
}

/** Texto de horario de un evento: "Todo el día", "10:00–12:30" o "10:00" */
export function textoHorarioEvento(e) {
  if (e.todo_el_dia) return 'Todo el día';
  if (e.hora_inicio && e.hora_fin) return `${horaCorta(e.hora_inicio)}–${horaCorta(e.hora_fin)}`;
  return horaCorta(e.hora_inicio) || '';
}

/** Tarjeta de evento (semana y modal del día). Pulsarla abre la edición */
export function htmlEvento(e, conNotas = false) {
  const notas = conNotas && e.notas ? `<small class="evento__notas">${escaparHTML(e.notas)}</small>` : '';
  return `<button type="button" class="evento evento--${e.quien}" data-evento="${escaparHTML(e.id)}">
    <span class="evento__emoji">${escaparHTML(e.emoji)}</span>
    <span class="evento__texto">
      <b>${escaparHTML(e.titulo)}</b>
      <small>${textoHorarioEvento(e)} · <span class="evento__quien">${PERSONAS[e.quien]?.nombre || ''}</span></small>
      ${notas}
    </span>
  </button>`;
}

// ---------- Vista de MES ----------

function htmlMes(fecha) {
  const a = fecha.getFullYear(), m = fecha.getMonth();
  const huecos = diaSemana(new Date(a, m, 1)); // días vacíos antes del día 1 (lunes = 0)
  const hoy = hoyISO();
  const libresJuntos = crearComprobadorJuntos();

  let html = '<div class="mes"><div class="mes__cabecera">';
  html += DIAS_CORTOS.map((d, i) => `<span class="${i >= 5 ? 'finde' : ''}">${d}</span>`).join('');
  html += '</div><div class="mes__rejilla">';

  for (let i = 0; i < huecos; i++) html += '<span class="dia dia--vacio" aria-hidden="true"></span>';

  for (const iso of diasVisibles('mes', fecha)) {
    const dani = turnoCompleto('dani', iso);
    const eva = turnoCompleto('eva', iso);
    const juntos = libresJuntos(iso);
    const eventos = eventosDe(iso);

    const clases = ['dia'];
    if (iso === hoy) clases.push('dia--hoy');
    if (iso < hoy) clases.push('dia--pasado');
    if (juntos) clases.push('dia--juntos');

    // Hasta 3 emojis de eventos y un "+N" si hay más
    const minis = eventos.slice(0, 3)
      .map(e => `<span class="ev-mini ev-mini--${e.quien}">${escaparHTML(e.emoji)}</span>`).join('')
      + (eventos.length > 3 ? `<span class="ev-mas">+${eventos.length - 3}</span>` : '');

    const etiqueta = `${fechaLarga(iso)}. Dani: ${nombreTurno(dani)} ${etiquetaLarga(dani)}. `
      + `Eva: ${nombreTurno(eva)} ${etiquetaLarga(eva)}.`
      + (juntos ? ' Libráis los dos.' : '') + (eventos.length ? ` ${eventos.length} evento(s).` : '');

    html += `<button type="button" class="${clases.join(' ')}" data-fecha="${iso}" aria-label="${etiqueta}">
      <span class="dia__arriba"><span class="dia__num">${deISO(iso).getDate()}</span>${juntos ? '<span class="corazon">♥</span>' : ''}</span>
      ${chipMes('dani', dani)}
      ${chipMes('eva', eva)}
      <span class="dia__eventos">${minis}</span>
    </button>`;
  }
  return html + '</div></div>';
}

// ---------- Vista de SEMANA ----------

function htmlSemana(fecha) {
  const hoy = hoyISO();
  const libresJuntos = crearComprobadorJuntos();

  const dias = diasVisibles('semana', fecha).map(iso => {
    const f = deISO(iso);
    const juntos = libresJuntos(iso);
    const eventos = eventosDe(iso);
    const clases = ['sdia'];
    if (iso === hoy) clases.push('sdia--hoy');
    if (juntos) clases.push('sdia--juntos');

    return `<article class="${clases.join(' ')}">
      <button type="button" class="sdia__cabecera" data-fecha="${iso}" aria-label="${fechaLarga(iso)}">
        <span class="sdia__nombre">${DIAS_ABREV[diaSemana(f)]}</span>
        <span class="sdia__num">${f.getDate()}</span>
        ${juntos ? '<span class="corazon">♥ libres</span>' : ''}
      </button>
      ${turnoSemana('dani', turnoCompleto('dani', iso), iso)}
      ${turnoSemana('eva', turnoCompleto('eva', iso), iso)}
      <div class="sdia__eventos">${eventos.map(e => htmlEvento(e)).join('')}</div>
    </article>`;
  });
  return `<div class="semana">${dias.join('')}</div>`;
}

/** Dibuja la vista elegida dentro del contenedor */
export function renderVista(vista, fecha, contenedor) {
  contenedor.innerHTML = vista === 'semana' ? htmlSemana(fecha) : htmlMes(fecha);
}

// ---------- RESUMEN (contadores, libres juntos y leyenda) ----------

export function renderResumen(vista, fecha, contenedor) {
  const dias = diasVisibles(vista, fecha);
  const libresJuntos = crearComprobadorJuntos();
  const trabajaDani = dias.filter(d => trabaja(turnoDe('dani', d))).length;
  const trabajaEva = dias.filter(d => trabaja(turnoDe('eva', d))).length;
  const juntos = dias.filter(libresJuntos);
  const periodo = vista === 'mes' ? 'este mes' : 'esta semana';

  // En la vista mes ponemos solo el número del día; en semana, "lun 26"
  const listaJuntos = juntos.map(iso => {
    const f = deISO(iso);
    return vista === 'mes' ? f.getDate() : `${DIAS_ABREV[diaSemana(f)]} ${f.getDate()}`;
  }).join(', ');

  const codigos = Object.keys(TURNOS)
    .filter(c => TURNOS[c].inicio)
    .map(c => `<span class="codigo"><b>${c}</b> ${textoHoras(c)}</span>`).join('');

  contenedor.innerHTML = `
    <div class="stats">
      <div class="stat stat--dani"><b>${trabajaDani}</b><span>Dani trabaja</span></div>
      <div class="stat stat--eva"><b>${trabajaEva}</b><span>Eva trabaja</span></div>
      <div class="stat stat--juntos"><b>${juntos.length}</b><span>Libres juntos</span></div>
    </div>
    <p class="libres-juntos">${juntos.length
      ? `♥ Días libres juntos ${periodo}: <strong>${listaJuntos}</strong>`
      : `Sin días libres juntos ${periodo} (o faltan turnos por poner)`}</p>
    <div class="leyenda">
      <span><i class="muestra muestra--dani"></i>Arriba = Dani</span>
      <span><i class="muestra muestra--eva"></i>Abajo = Eva</span>
      <span><i class="muestra muestra--juntos"></i>Evento juntos</span>
      <span><i class="muestra muestra--corazon"></i>♥ Libres los dos</span>
    </div>
    <div class="codigos">${codigos}<span class="codigo"><b>L</b> Libre</span>`
    + `<span class="codigo"><b>V</b> Vacaciones</span><span class="codigo"><b>17-22</b> horario a medida</span></div>`;
}
