'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  rutaEntre,
  tipoEmerg,
} from '../../lib/geo';

export default function Hospital() {
  const s = useGuard('hospital');
  const mp = useMapa(false, !!s);
  const id = s?.u?.id;

  const [pos, setPos] = useState(null);
  const [casos, setCasos] = useState([]);
  const [msg, setMsg] = useState({ t: '', ok: false });
  const [toma, setToma] = useState(false);
  const tomandoRef = useRef(false);
  const pj = useRef('');
  const nTomados = useRef(0);

  const u = useUbicacion(mp, setPos, true, !!s);

  // Guarda la ubicación del centro (para rutas y para el mapa del paciente).
  useEffect(() => {
    if (!s || !pos) return;
    sb.from('usuarios')
      .update({ lat: pos.lat, lng: pos.lng })
      .eq('id', s.u.id)
      .then(() => {});
  }, [s, pos]);

  // Todos los casos: en espera (pendientes) + los que tomó este centro.
  useVivo(
    'casos',
    async () => {
      if (!id) return;
      const { data, error } = await sb
        .from('casos')
        .select('*')
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

  const espera = useMemo(
    () =>
      casos
        .filter((c) => c.estado === 'pendiente')
        .sort((a, b) => a.urg - b.urg || new Date(a.creado) - new Date(b.creado)),
    [casos],
  );

  const tomados = useMemo(
    () => casos.filter((c) => c.estado === 'asignado' && c.hospital_id === id),
    [casos, id],
  );

  // Marcadores: emergencias en espera (rojo) + casos tomados con su ruta.
  const capa = useRef(null);
  const capaRuta = useRef(null);

  useEffect(() => {
    if (!mp) return;
    const { L, map } = mp;

    if (!capa.current) capa.current = L.layerGroup().addTo(map);
    const capaActual = capa.current;
    capaActual.clearLayers();

    if (pos) {
      L.marker([pos.lat, pos.lng], { icon: icono(L, 'med', '🏥') })
        .addTo(capaActual)
        .bindPopup(esc(s?.p?.nombre || 'Tu centro'));
    }

    espera
      .filter((c) => c.lat != null && c.lng != null)
      .forEach((c) => {
        L.marker(ll(c), { icon: icono(L, 'sel', '🚨') })
          .addTo(capaActual)
          .bindPopup(
            `<b>${esc(c.nombre)}</b><br>${esc(tipoEmerg(c.tipo).etiqueta)}<br>` +
              `Gravedad: ${URG[c.urg] || '—'}<br>${esc(c.cuadro)}`,
          );
      });

    // La ruta del caso tomado más reciente se enfoca sola.
    const recientes = tomados
      .filter((c) => c.lat != null && c.lng != null)
      .sort((a, b) => new Date(b.actualizado) - new Date(a.actualizado));
    const ultimo = recientes[0];

    if (!capaRuta.current) capaRuta.current = L.layerGroup().addTo(map);
    const capaRutaActual = capaRuta.current;
    capaRutaActual.clearLayers();

    for (const c of tomados) {
      if (c.lat == null || c.lng == null) continue;
      L.marker(ll(c), { icon: icono(L, 'pac', '🏠') })
        .addTo(capaActual)
        .bindPopup(
          `<b>${esc(c.nombre)}</b><br>${esc(tipoEmerg(c.tipo).etiqueta)}` +
            `<br>${fmtKm(c.km)} km · ~${fmtEta(c.eta)}`,
        );
      if (pos) dibujarRuta(L, capaRutaActual, { ...c, ruta: c.ruta });
    }

    if (tomados.length > nTomados.current && ultimo) {
      const puntos = parseRuta(ultimo.ruta);
      if (puntos) map.fitBounds(puntos, { padding: [50, 50] });
    }
    nTomados.current = tomados.length;
  }, [mp, pos, espera, tomados, s]);

  // Toma un caso: lo bloquea para otros hospitales y calcula la ruta.
  async function tomar(c) {
    if (tomandoRef.current) return;
    if (!pos) {
      setMsg({
        t: 'Primero marca la ubicación de tu centro (📍) para calcular la ruta.',
        ok: false,
      });
      return;
    }

    tomandoRef.current = true;
    setToma(true);
    const r = await rutaEntre([pos.lat, pos.lng], [c.lat, c.lng]);

    const { data, error } = await sb
      .from('casos')
      .update({
        estado: 'asignado',
        hospital_id: id,
        hospital_nombre: s.p.nombre,
        km: Number(r.km.toFixed(2)),
        eta: r.min,
        ruta: JSON.stringify(r.puntos),
        tipo_ruta: r.tipo_ruta,
      })
      .eq('id', c.id)
      .eq('estado', 'pendiente') // si otro hospital lo tomó antes, no aplica
      .select('id');

    tomandoRef.current = false;
    setToma(false);

    if (error) {
      setMsg({ t: 'No se pudo tomar el caso: ' + error.message, ok: false });
      return;
    }
    if (!data?.length) {
      setMsg({ t: '⚠ Otro hospital ya tomó este caso.', ok: false });
      return;
    }

    setMsg({
      t: `🚑 Caso tomado: ${c.nombre}. Sigue la ruta en el mapa (~${r.min} min).`,
      ok: true,
    });
  }

  async function finalizar(cid) {
    if (!window.confirm('¿Finalizar esta atención?')) return;

    const { error } = await sb
      .from('casos')
      .update({ estado: 'finalizado' })
      .eq('id', cid)
      .eq('hospital_id', id);

    if (error) {
      window.alert('No se pudo finalizar la atención: ' + error.message);
      return;
    }
  }

  return (
    <Shell titulo="Panel del hospital" nombre={s?.p?.nombre}>
      <main className="m3p">
        <aside className="z-form">
          <section className="card">
            <h2>🏥 Mi centro</h2>
            <p className="hint">{u.txt}</p>

            {u.aprox && (
              <p className="err">
                Ubicación aproximada. Marca el punto exacto del centro en el
                mapa.
              </p>
            )}

            <div className="row">
              <button type="button" className="ghost small" onClick={u.reubicar}>
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
                Haz clic en el mapa para marcar el punto exacto del centro.
              </p>
            )}
          </section>

          <section className="card">
            <h2>🚑 Casos tomados</h2>
            {tomados.length === 0 && (
              <p className="hint">No has tomado ningún caso todavía.</p>
            )}
            {tomados.map((c) => {
              const te = tipoEmerg(c.tipo);
              return (
                <div className="item" key={c.id}>
                  <b>{c.nombre}</b>{' '}
                  <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                  <p>
                    {te.emoji} {te.etiqueta}
                    {Number(c.urg) === 1 ? ' · 🚑 requiere ambulancia' : ''}
                  </p>
                  <p>{c.cuadro}</p>
                  {c.foto_url && (
                    <a href={c.foto_url} target="_blank" rel="noreferrer">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        className="mini"
                        src={c.foto_url}
                        alt="Foto de la emergencia"
                        loading="lazy"
                      />
                    </a>
                  )}
                  <p>
                    {fmtKm(c.km)} km · ~{fmtEta(c.eta)}
                    {c.tipo_ruta ? ` · ${c.tipo_ruta}` : ''}
                  </p>
                  <div className="row">
                    <button
                      type="button"
                      className="small danger"
                      onClick={() => finalizar(c.id)}
                    >
                      Finalizar atención
                    </button>
                  </div>
                </div>
              );
            })}
          </section>
        </aside>

        <section className="center z-map">
          <div id="map"></div>
          <p className="hint">
            🚨 Emergencia en espera · 🏠 Paciente · 🏥 Tu centro · 🚑 Ruta (azul)
          </p>
        </section>

        <aside className="z-centros">
          <section className="card">
            <h2 className="mb-0">🚨 Emergencias en espera</h2>

            {espera.length === 0 && (
              <p className="hint">No hay emergencias pendientes.</p>
            )}

            <div className="lista-centros">
              {espera.map((c) => {
                const te = tipoEmerg(c.tipo);
                const dist =
                  pos && c.lat != null
                    ? km([pos.lat, pos.lng], [c.lat, c.lng])
                    : null;
                return (
                  <div className="item" key={c.id}>
                    <b>{c.nombre}</b>{' '}
                    <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                    <p>
                      {te.emoji} {te.etiqueta}
                      {dist != null ? ` · ${dist.toFixed(1)} km` : ''}
                    </p>
                    <p>{c.cuadro}</p>
                    {c.foto_url && (
                      <a href={c.foto_url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          className="mini"
                          src={c.foto_url}
                          alt="Foto de la emergencia"
                          loading="lazy"
                        />
                      </a>
                    )}
                    <div className="row">
                      <button
                        type="button"
                        onClick={() => tomar(c)}
                        disabled={toma || !pos}
                      >
                        🚑 Tomar caso
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {!pos && (
              <p className="hint">
                Marca la ubicación de tu centro (📍) para poder tomar casos.
              </p>
            )}

            <p
              className={msg.ok ? 'ok' : 'err'}
              role="status"
              aria-live="polite"
            >
              {msg.t}
            </p>
          </section>
        </aside>
      </main>
    </Shell>
  );
}
