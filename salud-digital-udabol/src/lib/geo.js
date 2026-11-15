import { sb } from './supabase';

export const ADMIN_CODE = process.env.NEXT_PUBLIC_ADMIN_CODE || 'SALUD2026';

export const ESTADO = {
  pendiente: '⏳ En espera',
  asignado: '🚑 En camino',
  finalizado: '✔ Finalizado',
};

export const URG = ['', 'ALTA', 'MEDIA', 'BAJA'];

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
 * Asignación inteligente: médico libre más cercano (priorizando especialidad)
 * y ruta por calles con OSRM.
 *
 * El médico se bloquea de forma condicional (`libre = true`) antes de asignar
 * el caso para evitar que dos solicitudes simultáneas tomen al mismo médico.
 * Si la asignación del caso falla, el médico se libera de nuevo.
 *
 * @returns {Promise<object|null>} médico asignado o null si no fue posible.
 */
export async function asignar(id, c) {
  if (!id || !c || c.lat == null || c.lng == null) return null;

  const { data: ms, error } = await sb
    .from('usuarios')
    .select('*')
    .eq('rol', 'medico')
    .eq('libre', true)
    .not('lat', 'is', null)
    .not('lng', 'is', null);

  if (error || !ms || !ms.length) return null;

  const candidatos =
    c.esp && c.esp !== 'Cualquiera' ? ms.filter((m) => m.esp === c.esp) : ms;
  const pool = candidatos.length ? candidatos : ms;
  const distancia = (m) => km(ll(m), ll(c));
  const medico = pool.reduce((a, b) => (distancia(a) <= distancia(b) ? a : b));

  // Ruta y ETA (con respaldo a línea recta si OSRM no responde).
  let dist = distancia(medico);
  let eta = Math.round(dist * 2.5 + 5);
  let ruta = [ll(medico), ll(c)];
  let tipo = 'línea recta';

  try {
    const url =
      'https://router.project-osrm.org/route/v1/driving/' +
      `${medico.lng},${medico.lat};${c.lng},${c.lat}` +
      '?overview=full&geometries=geojson';
    const respuesta = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (respuesta.ok) {
      const r = await respuesta.json();
      const tramo = r?.routes?.[0];
      if (
        tramo?.geometry?.coordinates?.length &&
        Number.isFinite(tramo.distance) &&
        Number.isFinite(tramo.duration)
      ) {
        ruta = tramo.geometry.coordinates.map(([x, y]) => [y, x]);
        dist = tramo.distance / 1000;
        eta = Math.max(1, Math.round(tramo.duration / 60) + 2);
        tipo = 'calles (OSRM)';
      }
    }
  } catch {
    // Sin conexión a OSRM: se mantiene el cálculo en línea recta.
  }

  // Bloqueo atómico del médico.
  const { data: bloqueado } = await sb
    .from('usuarios')
    .update({ libre: false })
    .eq('id', medico.id)
    .eq('libre', true)
    .select('id');

  if (!bloqueado || !bloqueado.length) return null;

  const { data: asignado } = await sb
    .from('casos')
    .update({
      estado: 'asignado',
      medico_id: medico.id,
      medico_nombre: medico.nombre,
      km: Number(dist.toFixed(2)),
      eta,
      ruta: JSON.stringify(ruta),
      tipo_ruta: tipo,
    })
    .eq('id', id)
    .eq('estado', 'pendiente')
    .select('id');

  if (!asignado || !asignado.length) {
    // El caso ya no estaba pendiente: liberamos al médico.
    await sb.from('usuarios').update({ libre: true }).eq('id', medico.id);
    return null;
  }

  return medico;
}
