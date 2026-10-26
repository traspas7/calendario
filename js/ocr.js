// =============================================================
// ocr.js — Reconocimiento de texto de la planilla (sin IA ni APIs)
// -------------------------------------------------------------
// 1) preprocesar(): mejora la foto (gris + contraste + blanco y negro)
// 2) reconocer():   Tesseract.js lee el texto EN EL NAVEGADOR
// 3) buscarFila():  encuentra la línea con el nombre de la persona
// 4) extraerCodigos(): saca M, T, N, FM, FT, FN, L de esa fila
// =============================================================

import { cargarScript } from './utils.js';

const URL_TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

/** Carga Tesseract.js solo cuando hace falta (pesa bastante) */
export async function cargarTesseract() {
  if (!window.Tesseract) await cargarScript(URL_TESSERACT);
}

// =============================================================
// 1) MEJORA DE LA IMAGEN
// =============================================================
/**
 * Devuelve un <canvas> con la imagen lista para el OCR:
 *  - Reescalada a ~2400 px de ancho (Tesseract acierta más con letras grandes)
 *  - Escala de grises
 *  - Contraste estirado (lo más oscuro → negro, lo más claro → blanco)
 *  - Opcional: blanco y negro con umbral ADAPTATIVO, que funciona mejor
 *    que un umbral fijo cuando la foto tiene sombras o luz desigual.
 */
export function preprocesar(imagen, binarizar = true) {
  const anchoOriginal = imagen.naturalWidth || imagen.width;
  const altoOriginal = imagen.naturalHeight || imagen.height;

  // Escala: objetivo 2400 px de ancho, entre ×0,4 y ×3, y como máximo
  // 8 megapíxeles para no agotar la memoria del móvil.
  let escala = Math.min(3, Math.max(0.4, 2400 / anchoOriginal));
  const maxPixeles = 8e6;
  if (anchoOriginal * altoOriginal * escala * escala > maxPixeles) {
    escala = Math.sqrt(maxPixeles / (anchoOriginal * altoOriginal));
  }
  const W = Math.round(anchoOriginal * escala);
  const H = Math.round(altoOriginal * escala);

  const lienzo = document.createElement('canvas');
  lienzo.width = W;
  lienzo.height = H;
  const ctx = lienzo.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(imagen, 0, 0, W, H);

  const imgData = ctx.getImageData(0, 0, W, H);
  const px = imgData.data;               // RGBA seguidos: [r,g,b,a, r,g,b,a, …]
  const total = W * H;
  const gris = new Uint8ClampedArray(total);
  const histograma = new Uint32Array(256);

  // --- Escala de grises (fórmula de luminancia) ---
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    const g = (px[i] * 299 + px[i + 1] * 587 + px[i + 2] * 114) / 1000;
    gris[p] = g;
    histograma[gris[p]]++;
  }

  // --- Contraste: buscamos el 1 % más oscuro y el 1 % más claro ---
  let bajo = 0, alto = 255, acumulado = 0;
  for (let v = 0; v < 256; v++) { acumulado += histograma[v]; if (acumulado >= total * 0.01) { bajo = v; break; } }
  acumulado = 0;
  for (let v = 255; v >= 0; v--) { acumulado += histograma[v]; if (acumulado >= total * 0.01) { alto = v; break; } }
  const rango = Math.max(1, alto - bajo);
  const tabla = new Uint8ClampedArray(256); // tabla de conversión (más rápido que calcular cada píxel)
  for (let v = 0; v < 256; v++) tabla[v] = ((v - bajo) * 255) / rango;
  for (let p = 0; p < total; p++) gris[p] = tabla[gris[p]];

  // --- Blanco y negro adaptativo (método de Bradley) ---
  // Cada píxel se compara con la media de su zona: si es un 15 % más
  // oscuro que su entorno → negro (tinta); si no → blanco (papel).
  let salida = gris;
  if (binarizar) {
    // "Imagen integral": permite calcular la suma de cualquier rectángulo en 4 operaciones
    const integral = new Uint32Array((W + 1) * (H + 1));
    for (let y = 1; y <= H; y++) {
      let sumaFila = 0;
      for (let x = 1; x <= W; x++) {
        sumaFila += gris[(y - 1) * W + (x - 1)];
        integral[y * (W + 1) + x] = integral[(y - 1) * (W + 1) + x] + sumaFila;
      }
    }
    const radio = Math.max(8, Math.round(W / 16));
    const t = 0.15;
    salida = new Uint8ClampedArray(total);
    for (let y = 0; y < H; y++) {
      const y1 = Math.max(0, y - radio), y2 = Math.min(H - 1, y + radio);
      for (let x = 0; x < W; x++) {
        const x1 = Math.max(0, x - radio), x2 = Math.min(W - 1, x + radio);
        const area = (x2 - x1 + 1) * (y2 - y1 + 1);
        const suma = integral[(y2 + 1) * (W + 1) + (x2 + 1)] - integral[y1 * (W + 1) + (x2 + 1)]
          - integral[(y2 + 1) * (W + 1) + x1] + integral[y1 * (W + 1) + x1];
        salida[y * W + x] = gris[y * W + x] * area < suma * (1 - t) ? 0 : 255;
      }
    }
  }

  // Volcamos el resultado al canvas
  for (let p = 0, i = 0; p < total; p++, i += 4) {
    px[i] = px[i + 1] = px[i + 2] = salida[p];
    px[i + 3] = 255;
  }
  ctx.putImageData(imgData, 0, 0);
  return lienzo;
}

// =============================================================
// 2) RECONOCIMIENTO CON TESSERACT.JS
// =============================================================
const ESTADOS = {
  'loading tesseract core': 'Cargando el motor de lectura…',
  'initializing tesseract': 'Preparando el motor…',
  'loading language traineddata': 'Descargando el idioma español (solo la primera vez)…',
  'initializing api': 'Preparando…',
  'recognizing text': 'Leyendo el horario…',
};

/**
 * Lee el texto del canvas. alProgresar(mensaje, 0..1) informa del avance.
 * Todo ocurre en el navegador: la foto no se envía a ningún servidor.
 */
export async function reconocer(lienzo, alProgresar = () => {}) {
  alProgresar('Cargando Tesseract.js…', 0);
  await cargarTesseract();
  const worker = await window.Tesseract.createWorker('spa', 1, {
    logger: m => alProgresar(ESTADOS[m.status] || m.status, m.progress || 0),
  });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: '6',     // "bloque de texto uniforme": va bien con tablas
      preserve_interword_spaces: '1', // respeta los espacios entre columnas
    });
    const { data } = await worker.recognize(lienzo);
    return data.text || '';
  } finally {
    await worker.terminate(); // libera memoria
  }
}

// =============================================================
// 3) BUSCAR LA FILA DE LA PERSONA
// =============================================================

/** Quita tildes y pasa a mayúsculas: "Martínez" → "MARTINEZ" */
export function normalizar(texto) {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

/** Palabras "limpias" de un texto (solo letras y números) */
function palabras(texto) {
  return normalizar(texto).replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

/** Distancia de Levenshtein: cuántas letras hay que cambiar para pasar de a a b */
function distancia(a, b) {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

/** ¿Se parecen dos palabras? Tolera 1 error de OCR en palabras largas */
function parecida(palabra, objetivo) {
  if (palabra === objetivo) return true;
  return objetivo.length >= 5 && Math.abs(palabra.length - objetivo.length) <= 1 && distancia(palabra, objetivo) <= 1;
}

/** Divide el texto reconocido en líneas no vacías */
export function dividirLineas(texto) {
  return texto.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 1);
}

/**
 * Devuelve el índice de la línea que más palabras del nombre contiene
 * (o -1 si ninguna). Ej.: "Ana García López" → busca ANA, GARCIA
 * y LOPEZ, aunque el OCR se equivoque en una letra.
 */
export function buscarFila(lineas, nombre) {
  const objetivo = palabras(nombre).filter(p => p.length >= 3);
  if (!objetivo.length) return -1;
  let mejor = -1, mejorPuntos = 0;
  lineas.forEach((linea, i) => {
    const ps = palabras(linea);
    const puntos = objetivo.filter(o => ps.some(p => parecida(p, o))).length;
    if (puntos > mejorPuntos) { mejor = i; mejorPuntos = puntos; }
  });
  return mejorPuntos >= 1 ? mejor : -1;
}

// =============================================================
// 4) EXTRAER LOS CÓDIGOS DE TURNO
// =============================================================

/**
 * Convierte una palabra en códigos de turno, o null si no lo es.
 * Corrige confusiones típicas del OCR: "1", "I", "|", "!" → "L" y
 * "E" → "F" (Tesseract suele leer "FM" como "EM").
 * Si los códigos salen pegados ("MTL", "FMFT") los separa.
 */
function palabraACodigos(palabra) {
  let s = palabra.replace(/[.,;:'"`´_\-–—()[\]{}*·°]/g, '');
  if (!s) return null;
  s = s.replace(/[1Il|!]/g, 'L').toUpperCase();
  if (!/^[FEMTNL]+$/.test(s)) return null; // lleva otras letras: no es un turno
  const codigos = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === 'F' || s[i] === 'E') {
      if ('MTN'.includes(s[i + 1])) { codigos.push('F' + s[i + 1]); i++; } else return null; // "F" suelta: dudosa
    } else {
      codigos.push(s[i]);
    }
  }
  return codigos;
}

/** Códigos de una lista de palabras + cuántas palabras eran turnos */
function codigosDeLinea(linea) {
  const trozos = linea.split(/\s+/).filter(Boolean);
  const codigos = [];
  let validas = 0;
  for (const t of trozos) {
    const c = palabraACodigos(t);
    if (c) { codigos.push(...c); validas++; }
  }
  return { codigos, proporcion: trozos.length ? validas / trozos.length : 0 };
}

/**
 * Saca los turnos de la fila elegida.
 * - Ignora la parte del nombre (todo lo que hay hasta la última palabra del nombre).
 * - Si en esa línea faltan días (el OCR a veces parte la fila en dos),
 *   mira la línea siguiente, pero solo si casi todo son códigos.
 * Devuelve un array de longitud diasMes con "M", "T", … o "" (sin leer).
 */
export function extraerCodigos(lineas, indice, nombre, diasMes) {
  const objetivo = palabras(nombre);
  const trozos = lineas[indice].split(/\s+/);

  // Posición de la última palabra que forma parte del nombre
  let corte = -1;
  trozos.forEach((t, i) => {
    if (palabras(t).some(p => objetivo.some(o => parecida(p, o)))) corte = i;
  });

  let { codigos } = codigosDeLinea(trozos.slice(corte + 1).join(' '));

  // Completar con las líneas siguientes si hace falta (máximo 2)
  for (let j = indice + 1; codigos.length < diasMes && j < lineas.length && j <= indice + 2; j++) {
    const extra = codigosDeLinea(lineas[j]);
    if (extra.codigos.length < 3 || extra.proporcion < 0.6) break;
    codigos = codigos.concat(extra.codigos);
  }

  // Ajustamos a los días del mes (rellenamos con "" lo que falte)
  return Array.from({ length: diasMes }, (_, i) => codigos[i] || '');
}
