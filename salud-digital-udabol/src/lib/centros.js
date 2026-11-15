// Centros de salud de Oruro. Los datos base provienen de OpenStreetMap
// (consulta verificada) y se usan como respaldo cuando la API de Overpass no
// responde. No se inventan teléfonos ni horarios: solo se muestra lo que hay.

export const TIPOS = {
  hospital: { etiqueta: 'Hospital', emoji: '🏥', clase: 'hosp' },
  centro: { etiqueta: 'Centro de salud', emoji: '🩺', clase: 'csalud' },
  policlinica: { etiqueta: 'Policlínica', emoji: '🏨', clase: 'poli' },
};

/** @type {{id:string,nombre:string,tipo:keyof TIPOS,lat:number,lng:number,dir?:string,nota?:string}[]} */
export const CENTROS = [
  {
    id: 'hsjd',
    nombre: 'Hospital General San Juan de Dios',
    tipo: 'hospital',
    lat: -17.97587,
    lng: -67.11397,
    dir: 'Calle 6 de Octubre, Distrito 1',
    nota: 'Hospital de referencia departamental',
  },
  {
    id: 'materno',
    nombre: 'Hospital Materno Infantil',
    tipo: 'hospital',
    lat: -17.96012,
    lng: -67.11004,
    dir: 'Calle 6 de Octubre, Barrio Jardín',
    nota: 'Maternidad y pediatría',
  },
  {
    id: 'corea',
    nombre: 'Hospital Corea',
    tipo: 'hospital',
    lat: -17.97671,
    lng: -67.09976,
    dir: 'Avenida Antofagasta, Distrito 1',
  },
  {
    id: 'obrero',
    nombre: 'Hospital Obrero',
    tipo: 'hospital',
    lat: -17.9572,
    lng: -67.11274,
    dir: 'Rotonda Sargento Flores y La Paz, Distrito 1',
    nota: 'Caja Nacional de Salud',
  },
  {
    id: 'cns',
    nombre: 'Caja Nacional de Salud Oruro',
    tipo: 'policlinica',
    lat: -17.96952,
    lng: -67.11411,
    dir: 'Calle La Plata, Distrito 1',
    nota: 'Seguro social',
  },
  {
    id: 'policlinica',
    nombre: 'Policlínica Oruro',
    tipo: 'policlinica',
    lat: -17.96231,
    lng: -67.11064,
    dir: 'Calle Rodríguez 580',
    nota: 'Atención ambulatoria',
  },
  {
    id: 'pagador',
    nombre: 'Hospital Sebastián Pagador (Policía)',
    tipo: 'hospital',
    lat: -17.93721,
    lng: -67.11607,
    dir: 'Calle Humberto James Zuna, Distrito 2',
  },
  {
    id: 'yugoslavo',
    nombre: 'Centro de Salud Yugoslavo',
    tipo: 'centro',
    lat: -17.93421,
    lng: -67.11662,
    dir: 'Calle Mario Quiroga, Distrito 2',
  },
  {
    id: 'auxiliadora',
    nombre: 'Centro de Salud María Auxiliadora',
    tipo: 'centro',
    lat: -17.94258,
    lng: -67.09679,
    dir: 'RN12 Oruro–Ocotavi, Distrito 3',
  },
  {
    id: 'rumy',
    nombre: 'Centro de Salud Rumy Campana',
    tipo: 'centro',
    lat: -17.95058,
    lng: -67.1252,
    dir: 'Benedetto Vincenti, Distrito 2',
  },
  {
    id: 'candelaria',
    nombre: 'Centro de Salud Candelaria',
    tipo: 'centro',
    lat: -17.94838,
    lng: -67.10612,
    dir: 'Calle B, Distrito 3',
  },
  {
    id: 'chiripujio',
    nombre: 'Centro de Salud Chiripujio',
    tipo: 'centro',
    lat: -17.9774,
    lng: -67.1362,
    dir: 'Avenida España, Distrito 5',
  },
  {
    id: 'caracollo',
    nombre: 'Centro de Salud Caracollo',
    tipo: 'centro',
    lat: -17.63722,
    lng: -67.21735,
    dir: 'Avenida R. Bernal, Caracollo',
  },
  {
    id: 'machacamarca',
    nombre: 'Centro de Salud Machacamarca',
    tipo: 'centro',
    lat: -18.1711,
    lng: -67.01764,
    dir: 'Avenida Oruro, Machacamarca',
  },
];

/** Tipo válido a partir de las etiquetas de OpenStreetMap. */
export function tipoDesdeOsm(t) {
  const v = String(t.healthcare || t.amenity || '');
  if (v === 'hospital') return 'hospital';
  if (v === 'clinic' || v === 'centre' || v === 'doctor' || v === 'doctors')
    return 'centro';
  return null;
}
