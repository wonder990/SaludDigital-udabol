export const ESTADO = {
  pendiente: '⏳ En espera',
  asignado: '🚑 Tomado',
  finalizado: '✔ Finalizado',
};

export const URG = ['', 'ALTA', 'MEDIA', 'BAJA'];

/**
 * Tipos de emergencia que el paciente puede reportar.
 * Se usan en el panel del paciente y en el panel del hospital.
 */
export const TIPO_EMERG = [
  { id: 'transito', etiqueta: 'Accidente de tránsito', emoji: '🚗' },
  { id: 'atropello', etiqueta: 'Atropello', emoji: '🚶' },
  { id: 'caida', etiqueta: 'Caída grave', emoji: '🤕' },
  { id: 'trabajo', etiqueta: 'Accidente laboral', emoji: '🏗️' },
  { id: 'otro', etiqueta: 'Otra emergencia', emoji: '🆘' },
];

export const tipoEmerg = (id) =>
  TIPO_EMERG.find((t) => t.id === id) || TIPO_EMERG[4];

export const ll = (o) => [Number(o.lat), Number(o.lng)];

export const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

/** Formatea una distancia en km sin romper si el dato no existe. */
export const fmtKm = (v) => {
  if (v === null || v === undefined || v === '') return '–';
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(1) : '–';
};

/** Formatea un ETA en minutos. */
export const fmtEta = (v) => {
  if (v === null || v === undefined || v === '') return '–';
  const n = Number(v);
  return Number.isFinite(n) ? `${Math.round(n)} min` : '–';
};

/** Convierte la columna `ruta` (JSON en texto) en puntos válidos de Leaflet. */
export function parseRuta(ruta) {
  if (!ruta) return null;
  try {
    const puntos = typeof ruta === 'string' ? JSON.parse(ruta) : ruta;
    if (!Array.isArray(puntos) || puntos.length < 2) return null;
    const limpios = puntos
      .map(([lat, lng]) => [Number(lat), Number(lng)])
      .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
    return limpios.length >= 2 ? limpios : null;
  } catch {
    return null;
  }
}

// Haversine (km)
export function km(a, b) {
  const R = 6371;
  const r = Math.PI / 180;
  const dLa = (b[0] - a[0]) * r;
  const dLo = (b[1] - a[1]) * r;
  const h =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Ruta por calles con OSRM.
 *
 * @param {[number,number]} a origen [lat,lng]
 * @param {[number,number]} b destino [lat,lng]
 * @returns {Promise<{puntos:[number,number][], km:number, min:number}|null>}
 *   null si OSRM no responde (el llamador decide el respaldo).
 */
export async function rutaOsrm(a, b, timeout = 7000) {
  try {
    const url =
      'https://router.project-osrm.org/route/v1/driving/' +
      `${a[1]},${a[0]};${b[1]},${b[0]}` +
      '?overview=full&geometries=geojson';
    const r = await fetch(url, { signal: AbortSignal.timeout(timeout) });
    if (!r.ok) return null;
    const j = await r.json();
    const t = j?.routes?.[0];
    if (!t?.geometry?.coordinates?.length) return null;
    return {
      puntos: t.geometry.coordinates.map(([x, y]) => [y, x]),
      km: t.distance / 1000,
      min: Math.max(1, Math.round(t.duration / 60)),
    };
  } catch {
    return null;
  }
}

/**
 * Ruta entre dos puntos por calles (OSRM) con respaldo a línea recta
 * si OSRM no responde. La usa el hospital al tomar un caso.
 *
 * @param {[number,number]} a origen [lat,lng]
 * @param {[number,number]} b destino [lat,lng]
 * @returns {Promise<{puntos:[number,number][], km:number, min:number, tipo_ruta:string}>}
 */
export async function rutaEntre(a, b) {
  const r = await rutaOsrm(a, b);
  if (r) return { ...r, tipo_ruta: 'calles (OSRM)' };

  const dist = km(a, b);
  return {
    puntos: [a, b],
    km: dist,
    min: Math.max(1, Math.round(dist * 2.5 + 5)),
    tipo_ruta: 'línea recta',
  };
}
