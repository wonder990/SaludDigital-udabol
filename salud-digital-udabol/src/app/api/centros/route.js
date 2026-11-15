import { CENTROS, tipoDesdeOsm } from '../../../lib/centros';

export const dynamic = 'force-dynamic';
export const maxDuration = 10;

// Caché en memoria por instancia: evita golpear Overpass en cada visita.
const cache = new Map();
const TTL = 6 * 60 * 60 * 1000;

const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const distancia = (a, b) => {
  const r = Math.PI / 180;
  const dLa = (b[0] - a[0]) * r;
  const dLo = (b[1] - a[1]) * r;
  const h =
    Math.sin(dLa / 2) ** 2 +
    Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

/** Consulta Overpass (OpenStreetMap). Devuelve [] si no responde a tiempo. */
async function buscarOsm(lat, lng, radioKm) {
  const dLat = radioKm / 111;
  const dLng = radioKm / (111 * Math.cos((lat * Math.PI) / 180));
  const bbox = [lat - dLat, lng - dLng, lat + dLat, lng + dLng]
    .map((v) => v.toFixed(4))
    .join(',');

  const consulta = `[out:json][timeout:6];
(
  nwr["amenity"~"^(hospital|clinic|doctors)$"](${bbox});
  nwr["healthcare"~"^(hospital|clinic|centre|doctor)$"](${bbox});
);
out center tags;`;

  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'SaludMovilBolivia/1.0 (demo academico)',
      },
      body: 'data=' + encodeURIComponent(consulta),
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.elements || [])
      .map((e) => {
        const t = e.tags || {};
        const tipo = tipoDesdeOsm(t);
        const la = e.lat ?? e.center?.lat;
        const ln = e.lon ?? e.center?.lon;
        if (!tipo || !t.name || la == null || ln == null) return null;
        return {
          id: 'osm-' + e.type + '-' + e.id,
          nombre: t.name,
          tipo,
          lat: Number(la),
          lng: Number(ln),
          dir: [t['addr:street'], t['addr:housenumber']]
            .filter(Boolean)
            .join(' '),
          tel: t.phone || t['contact:phone'] || null,
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const lat = num(searchParams.get('lat'), -17.9667);
  const lng = num(searchParams.get('lng'), -67.1167);
  const radio = Math.min(Math.max(num(searchParams.get('r'), 15), 1), 60);

  const clave = `${lat.toFixed(2)},${lng.toFixed(2)},${radio}`;
  const guardado = cache.get(clave);
  const ahora = Date.now();

  let centros =
    guardado && ahora - guardado.t < TTL ? guardado.lista : null;
  let fuente = 'local';

  if (!centros) {
    const osm = await buscarOsm(lat, lng, radio);
    // Los centros base tienen prioridad: si OSM trae uno a menos de 200 m se
    // descarta para no duplicar el marcador.
    const extra = osm.filter(
      (o) =>
        !CENTROS.some(
          (c) => distancia([c.lat, c.lng], [o.lat, o.lng]) < 0.2,
        ),
    );
    centros = [...CENTROS, ...extra];
    fuente = osm.length ? 'osm' : 'local';
    cache.set(clave, { t: ahora, lista: centros });
  }

  const ordenados = centros
    .map((c) => ({ ...c, dist: Number(distancia([lat, lng], [c.lat, c.lng]).toFixed(2)) }))
    .filter((c) => c.dist <= radio)
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 60);

  return Response.json({ fuente, centros: ordenados });
}
