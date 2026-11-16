'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Shell from '../../components/Shell';
import {
  useGuard,
  useMapa,
  useVivo,
  useUbicacion,
  icono,
  dibujarRuta,
} from '../../components/hooks';
import { sb } from '../../lib/supabase';
import {
  ESTADO,
  URG,
  ll,
  parseRuta,
  fmtKm,
  fmtEta,
  km,
  esc,
  rutaOsrm,
  TIPO_EMERG,
  tipoEmerg,
} from '../../lib/geo';
import { CENTROS, TIPOS } from '../../lib/centros';

const MAPS = (c) =>
  `https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lng}&travelmode=driving`;

export default function Paciente() {
  const s = useGuard('paciente');
  const mp = useMapa(false, !!s);
  const [pos, setPos] = useState(null);
  const [casos, setCasos] = useState([]);
  const [msg, setMsg] = useState({ t: '', ok: false });
  const [cuadro, setCuadro] = useState('');
  const [tipo, setTipo] = useState('transito');
  const [urg, setUrg] = useState('2');
  const [foto, setFoto] = useState(null);
  const [fotoVista, setFotoVista] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [centros, setCentros] = useState(CENTROS);
  const [verCentros, setVerCentros] = useState(true);
  const [filtro, setFiltro] = useState('todos');
  const [ruta, setRuta] = useState(null);
  const [buscando, setBuscando] = useState(false);

  const capa = useRef(null);
  const capaCentros = useRef(null);
  const capaRuta = useRef(null);
  const irARef = useRef(null);
  const ultimo = useRef('');
  const pj = useRef('');
  const enviandoRef = useRef(false);

  const u = useUbicacion(mp, setPos, true, !!s);

  useVivo(
    'casos',
    async () => {
      if (!s?.u?.id) return;
      const { data, error } = await sb
        .from('casos')
        .select('*')
        .eq('paciente_id', s.u.id)
        .order('creado', { ascending: false });
      if (error) return;

      const serializado = JSON.stringify(data || []);
      if (serializado !== pj.current) {
        pj.current = serializado;
        setCasos(data || []);
      }
    },
    !!s,
  );

  useEffect(() => {
    if (!mp) return;
    const { L, map } = mp;

    if (!capa.current) capa.current = L.layerGroup().addTo(map);
    const capaActual = capa.current;
    capaActual.clearLayers();

    const activo = casos.find(
      (c) => c.estado === 'asignado' && c.lat != null && c.lng != null,
    );
    if (!activo) return;

    dibujarRuta(L, capaActual, activo);
    L.marker(ll(activo), { icon: icono(L, 'pac', '🏠') }).addTo(capaActual);

    const puntos = parseRuta(activo.ruta);
    if (puntos && ultimo.current !== activo.ruta) {
      map.fitBounds(puntos, { padding: [50, 50] });
      ultimo.current = activo.ruta;
    }
  }, [mp, casos]);

  // Centros de salud: la API intenta OpenStreetMap y cae a la lista base.
  useEffect(() => {
    if (!s) return;
    let cancelado = false;
    fetch('/api/centros?lat=-17.9667&lng=-67.1167&r=20')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelado && j?.centros?.length) setCentros(j.centros);
      })
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [s]);

  // Posición redondeada a ~100 m: evita recalcular en cada lectura del GPS.
  const posKey = pos ? `${pos.lat.toFixed(3)},${pos.lng.toFixed(3)}` : '';

  const visibles = useMemo(() => {
    const origen = posKey ? posKey.split(',').map(Number) : null;
    return centros
      .filter((c) => filtro === 'todos' || c.tipo === filtro)
      .map((c) => ({
        ...c,
        dist: origen ? km(origen, [c.lat, c.lng]) : c.dist,
      }))
      .sort((a, b) => (a.dist ?? 9e9) - (b.dist ?? 9e9));
  }, [centros, filtro, posKey]);

  // Marcadores de los centros en el mapa.
  useEffect(() => {
    if (!mp) return;
    const { map, L } = mp;
    if (!capaCentros.current) {
      capaCentros.current = L.layerGroup().addTo(map);
    }
    const capaActual = capaCentros.current;
    capaActual.clearLayers();
    if (!verCentros) return;

    for (const c of visibles) {
      const t = TIPOS[c.tipo] || TIPOS.centro;
      const marcador = L.marker([c.lat, c.lng], {
        icon: icono(L, t.clase, t.emoji),
        title: c.nombre,
      }).addTo(capaActual);

      marcador.bindPopup(
        `<b>${esc(c.nombre)}</b><br>${esc(t.etiqueta)}` +
          (c.dir ? `<br>${esc(c.dir)}` : '') +
          (c.dist != null ? `<br>a ${c.dist.toFixed(1)} km` : '') +
          `<br><button type="button" class="pop-ruta" data-id="${esc(c.id)}">🧭 Trazar ruta</button>`,
      );
      marcador.on('popupopen', (ev) => {
        const b = ev.popup.getElement()?.querySelector('.pop-ruta');
        if (b) b.onclick = () => irARef.current?.(c);
      });
    }
  }, [mp, verCentros, visibles]);

  // Dibuja la ruta elegida.
  useEffect(() => {
    if (!mp) return;
    const { map, L } = mp;
    if (!capaRuta.current) capaRuta.current = L.layerGroup().addTo(map);
    const capaActual = capaRuta.current;
    capaActual.clearLayers();
    if (!ruta) return;
    L.polyline(ruta.puntos, { color: '#dc2626', weight: 5, opacity: 0.9 })
      .addTo(capaActual)
      .bindPopup(`${esc(ruta.centro.nombre)} · ${fmtKm(ruta.km)} km`);
    map.fitBounds(ruta.puntos, { padding: [40, 40] });
  }, [mp, ruta]);

  async function irA(centro) {
    if (!pos) {
      setMsg({
        t: 'Primero marca tu ubicación (📍) para calcular la ruta.',
        ok: false,
      });
      return;
    }
    setBuscando(true);
    const r = await rutaOsrm([pos.lat, pos.lng], [centro.lat, centro.lng]);
    if (r) {
      setRuta({ centro, ...r, exacta: true });
    } else {
      const d = km([pos.lat, pos.lng], [centro.lat, centro.lng]);
      setRuta({
        centro,
        puntos: [
          [pos.lat, pos.lng],
          [centro.lat, centro.lng],
        ],
        km: d,
        min: Math.max(1, Math.round(d * 3)),
        exacta: false,
      });
    }
    setBuscando(false);
  }

  // Ruta más rápida: compara por calles los 3 centros más cercanos.
  async function masRapido() {
    if (!pos) {
      setMsg({
        t: 'Primero marca tu ubicación (📍) para calcular la ruta.',
        ok: false,
      });
      return;
    }
    const cerca = visibles.slice(0, 3);
    if (!cerca.length) return;

    setBuscando(true);
    const pruebas = await Promise.all(
      cerca.map(async (c) => ({
        c,
        r: await rutaOsrm([pos.lat, pos.lng], [c.lat, c.lng]),
      })),
    );
    const conRuta = pruebas.filter((x) => x.r);
    if (conRuta.length) {
      const mejor = conRuta.reduce((a, b) => (b.r.min < a.r.min ? b : a));
      setRuta({ centro: mejor.c, ...mejor.r, exacta: true });
    } else {
      await irA(cerca[0]);
    }
    setBuscando(false);
  }

  // Mantiene la referencia al manejador actual sin recrear los marcadores.
  useEffect(() => {
    irARef.current = irA;
  });

  async function solicitar(e) {
    e.preventDefault();
    if (enviandoRef.current) return;

    if (!s?.u?.id) {
      setMsg({ t: 'Tu sesión aún se está verificando. Intenta de nuevo.', ok: false });
      return;
    }

    const texto = cuadro.trim();
    if (texto.length < 3) {
      setMsg({ t: 'Describe brevemente qué está pasando en la emergencia.', ok: false });
      return;
    }
    if (!pos) {
      setMsg({
        t: 'Aún no se obtiene tu ubicación. Activa el GPS y permite el acceso en el navegador.',
        ok: false,
      });
      return;
    }

    enviandoRef.current = true;
    setEnviando(true);
    setMsg({ t: 'Enviando reporte…', ok: true });

    try {
      // Sube la foto (opcional) a Supabase Storage.
      let foto_url = null;
      if (foto) {
        const ext =
          (foto.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') ||
          'jpg';
        const ruta = `${s.u.id}/${Date.now()}.${ext}`;
        const { error: errorFoto } = await sb.storage
          .from('evidencias')
          .upload(ruta, foto, { contentType: foto.type || 'image/jpeg' });
        if (errorFoto) {
          setMsg({
            t: 'No se pudo subir la foto, intenta de nuevo: ' + errorFoto.message,
            ok: false,
          });
          return;
        }
        foto_url = sb.storage.from('evidencias').getPublicUrl(ruta).data?.publicUrl;
      }

      const datos = {
        paciente_id: s.u.id,
        nombre: s.p.nombre,
        cuadro: texto,
        tipo,
        urg: Number(urg),
        foto_url,
        lat: pos.lat,
        lng: pos.lng,
      };

      const { data: caso, error } = await sb
        .from('casos')
        .insert(datos)
        .select()
        .single();

      if (error) {
        setMsg({ t: 'No se pudo registrar el reporte: ' + error.message, ok: false });
        return;
      }

      setCuadro('');
      setFoto(null);
      setFotoVista(null);
      const grave = Number(urg) === 1;
      setMsg(
        grave
          ? {
              t: '🚑 Emergencia grave registrada. Los hospitales la verán de inmediato en su panel.',
              ok: true,
            }
          : {
              t: 'Reporte enviado. Los hospitales lo verán y uno lo tomará cuando esté listo para atender.',
              ok: true,
            },
      );
    } catch (e2) {
      setMsg({ t: 'Error inesperado: ' + e2.message, ok: false });
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  return (
    <Shell titulo="Panel del paciente" nombre={s?.p?.nombre}>
      <main className="m3p">
        <aside className="z-form">
          <section className="card">
            <h2>🚨 Reportar emergencia</h2>
            <form onSubmit={solicitar}>
              <label className="sr-only" htmlFor="tipo">
                Tipo de emergencia
              </label>
              <select id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {TIPO_EMERG.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.emoji} {t.etiqueta}
                  </option>
                ))}
              </select>

              <label className="sr-only" htmlFor="urg">
                Gravedad
              </label>
              <select id="urg" value={urg} onChange={(e) => setUrg(e.target.value)}>
                <option value="1">🚑 Gravedad alta · requiere ambulancia</option>
                <option value="2">Gravedad media</option>
                <option value="3">Gravedad baja</option>
              </select>

              <label className="sr-only" htmlFor="cuadro">
                Descripción de la emergencia
              </label>
              <textarea
                id="cuadro"
                rows={3}
                maxLength={300}
                placeholder="¿Qué pasó? ¿Cuántas personas hay afectadas?"
                required
                value={cuadro}
                onChange={(e) => setCuadro(e.target.value)}
              />

              <label className="btn-file">
                📷 Tomar o adjuntar foto del accidente
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setFoto(f);
                    if (fotoVista) URL.revokeObjectURL(fotoVista);
                    setFotoVista(f ? URL.createObjectURL(f) : null);
                  }}
                />
              </label>

              {fotoVista && (
                <div className="vista-foto">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={fotoVista} alt="Foto de la emergencia" />
                  <button
                    type="button"
                    className="ghost small"
                    onClick={() => {
                      URL.revokeObjectURL(fotoVista);
                      setFoto(null);
                      setFotoVista(null);
                    }}
                  >
                    Quitar foto
                  </button>
                </div>
              )}

              <div className="bloque">
                <h3>📍 Tu ubicación</h3>
                <p className="hint">{u.txt}</p>

                {u.aprox && (
                  <p className="err">
                    Ubicación aproximada. Marca tu punto exacto en el mapa.
                  </p>
                )}

                <div className="row">
                  <button
                    type="button"
                    className="ghost small"
                    onClick={u.reubicar}
                  >
                    📍 Usar mi ubicación real
                  </button>
                  {(u.aprox || u.falloGps) && !u.sim && (
                    <button
                      type="button"
                      className="ghost small"
                      onClick={() => u.setSim(true)}
                    >
                      📌 Marcar en el mapa
                    </button>
                  )}
                </div>

                <label className="hint">
                  <input
                    type="checkbox"
                    checked={u.sim}
                    onChange={(e) => u.setSim(e.target.checked)}
                  />{' '}
                  Elegir mi ubicación en el mapa (sin GPS)
                </label>
                {u.sim && (
                  <p className="hint">
                    Haz clic en el mapa para marcar el punto exacto de tu casa.
                  </p>
                )}
              </div>

              <button type="submit" disabled={enviando}>
                {enviando ? 'Enviando…' : '🚑 Enviar reporte de emergencia'}
              </button>

              <p
                className={msg.ok ? 'ok' : 'err'}
                role="status"
                aria-live="polite"
              >
                {msg.t}
              </p>
            </form>
          </section>

          <section className="card">
            <h2>📋 Mis reportes</h2>
            {casos.length === 0 && <p className="hint">Aún no has reportado emergencias.</p>}
            {casos.map((c) => {
              const te = tipoEmerg(c.tipo);
              return (
                <div className="item" key={c.id}>
                  <b>{ESTADO[c.estado] || c.estado}</b>{' '}
                  <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                  <p>
                    {te.emoji} {te.etiqueta}
                  </p>
                  <p>{c.cuadro}</p>
                  {c.foto_url && (
                    <a href={c.foto_url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="mini"
                        src={c.foto_url}
                        alt="Foto del reporte"
                        loading="lazy"
                      />
                    </a>
                  )}
                  {c.hospital_nombre && (
                    <p>
                      🏥 {c.hospital_nombre} tomó tu reporte · {fmtKm(c.km)} km
                      · llega en ~{fmtEta(c.eta)}
                    </p>
                  )}
                </div>
              );
            })}
          </section>
        </aside>

        <section className="center z-map">
          <div id="map"></div>
          <p className="hint">
            🏥 Hospital · 🩺 Centro de salud · 🏨 Policlínica · 📍 Tu ubicación ·
            🚑 Ruta del hospital (azul)
          </p>
        </section>

        <aside className="z-centros">
          <section className="card">
            <div className="row between">
              <h2 className="mb-0">🏥 Centros de salud</h2>
              <label className="hint">
                <input
                  type="checkbox"
                  checked={verCentros}
                  onChange={(e) => setVerCentros(e.target.checked)}
                  aria-label="Mostrar centros en el mapa"
                />{' '}
                En el mapa
              </label>
            </div>

            {!verCentros && visibles[0] && (
              <p className="hint">
                Más cercano: <b>{visibles[0].nombre}</b>
                {visibles[0].dist != null
                  ? ` · ${visibles[0].dist.toFixed(1)} km`
                  : ''}
              </p>
            )}

            {verCentros && (
              <div className="panel-centros">
                <div className="chips" role="group" aria-label="Tipo de centro">
                  {['todos', 'hospital', 'centro', 'policlinica'].map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`chip${filtro === k ? ' on' : ''}`}
                      aria-pressed={filtro === k}
                      onClick={() => setFiltro(k)}
                    >
                      {k === 'todos'
                        ? 'Todos'
                        : k === 'centro'
                          ? '🩺 Centro'
                          : `${TIPOS[k].emoji} ${TIPOS[k].etiqueta}`}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={masRapido}
                  disabled={buscando || !pos || !visibles.length}
                >
                  {buscando ? 'Calculando…' : '🧭 Ruta al más rápido'}
                </button>

                {!pos && (
                  <p className="hint">
                    Marca tu ubicación (📍) para ver distancias y calcular
                    rutas.
                  </p>
                )}

                {ruta && (
                  <div className="item ruta">
                    <b>{ruta.centro.nombre}</b>
                    <p>
                      {TIPOS[ruta.centro.tipo]?.etiqueta} · {fmtKm(ruta.km)} km
                      · {fmtEta(ruta.min)}
                      {ruta.exacta ? '' : ' · en línea recta'}
                    </p>
                    <div className="row">
                      <a
                        className="enlace-btn"
                        href={MAPS(ruta.centro)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        🧭 Navegar en Maps
                      </a>
                      <button
                        type="button"
                        className="ghost small"
                        onClick={() => setRuta(null)}
                      >
                        Quitar ruta
                      </button>
                    </div>
                  </div>
                )}

                <div className="lista-centros">
                  {visibles.length === 0 && (
                    <p className="hint">No hay centros de este tipo cerca.</p>
                  )}

                  {visibles.map((c) => {
                    const t = TIPOS[c.tipo] || TIPOS.centro;
                    return (
                      <div className="item" key={c.id}>
                        <b>
                          {t.emoji} {c.nombre}
                        </b>
                        <p>
                          {t.etiqueta}
                          {c.dir ? ` · ${c.dir}` : ''}
                          {c.dist != null ? ` · ${c.dist.toFixed(1)} km` : ''}
                        </p>
                        <div className="row">
                          <button
                            type="button"
                            className="small"
                            onClick={() => irA(c)}
                            disabled={buscando || !pos}
                          >
                            🧭 Ruta
                          </button>
                          <a
                            className="enlace-btn"
                            href={MAPS(c)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Maps
                          </a>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="hint">
                  Para una emergencia grave, reporta desde{' '}
                  <b>🚨 Reportar emergencia</b> y la ambulancia irá a tu punto.
                </p>
              </div>
            )}
          </section>
        </aside>
      </main>
    </Shell>
  );
}
