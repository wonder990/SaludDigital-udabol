'use client';

import { useEffect, useRef, useState } from 'react';
import Shell from '../../components/Shell';
import {
  useGuard,
  useMapa,
  useVivo,
  useMedicos,
  useUbicacion,
  icono,
  dibujarRuta,
} from '../../components/hooks';
import { sb } from '../../lib/supabase';
import {
  asignar,
  ESTADO,
  URG,
  ll,
  parseRuta,
  fmtKm,
  fmtEta,
} from '../../lib/geo';

export default function Paciente() {
  const s = useGuard('paciente');
  const mp = useMapa(false, !!s);
  const [pos, setPos] = useState(null);
  const [casos, setCasos] = useState([]);
  const [msg, setMsg] = useState({ t: '', ok: false });
  const [cuadro, setCuadro] = useState('');
  const [esp, setEsp] = useState('Cualquiera');
  const [urg, setUrg] = useState('2');
  const [enviando, setEnviando] = useState(false);

  const capa = useRef(null);
  const ultimo = useRef('');
  const pj = useRef('');
  const enviandoRef = useRef(false);

  useMedicos(mp, null, !!s);
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

  async function solicitar(e) {
    e.preventDefault();
    if (enviandoRef.current) return;

    if (!s?.u?.id) {
      setMsg({ t: 'Tu sesión aún se está verificando. Intenta de nuevo.', ok: false });
      return;
    }

    const texto = cuadro.trim();
    if (texto.length < 3) {
      setMsg({ t: 'Describe brevemente tus síntomas o el motivo de consulta.', ok: false });
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
    setMsg({ t: 'Enviando solicitud…', ok: true });

    try {
      const datos = {
        paciente_id: s.u.id,
        nombre: s.p.nombre,
        cuadro: texto,
        esp,
        urg: Number(urg),
        lat: pos.lat,
        lng: pos.lng,
      };

      const { data: caso, error } = await sb
        .from('casos')
        .insert(datos)
        .select()
        .single();

      if (error) {
        setMsg({ t: 'No se pudo registrar la solicitud: ' + error.message, ok: false });
        return;
      }

      setCuadro('');
      const medico = await asignar(caso.id, caso);
      setMsg(
        medico
          ? {
              t: `Médico asignado: ${medico.nombre} (${medico.esp}). Revisa el mapa.`,
              ok: true,
            }
          : {
              t: 'No hay médicos disponibles ahora; tu solicitud quedó en espera.',
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
      <main className="m2">
        <aside>
          <section className="card">
            <h2>🩺 Solicitar atención</h2>
            <form onSubmit={solicitar}>
              <label className="sr-only" htmlFor="cuadro">
                Síntomas o motivo de consulta
              </label>
              <textarea
                id="cuadro"
                rows={3}
                maxLength={300}
                placeholder="Síntomas / motivo de consulta"
                required
                value={cuadro}
                onChange={(e) => setCuadro(e.target.value)}
              />

              <label className="sr-only" htmlFor="esp">
                Especialidad
              </label>
              <select id="esp" value={esp} onChange={(e) => setEsp(e.target.value)}>
                <option>Cualquiera</option>
                <option>Medicina General</option>
                <option>Pediatría</option>
                <option>Geriatría</option>
              </select>

              <label className="sr-only" htmlFor="urg">
                Urgencia
              </label>
              <select id="urg" value={urg} onChange={(e) => setUrg(e.target.value)}>
                <option value="1">Urgencia alta</option>
                <option value="2">Urgencia media</option>
                <option value="3">Urgencia baja</option>
              </select>

              <p className="hint">{u.txt}</p>

              {u.aprox && (
                <p className="err">
                  La ubicación del navegador es aproximada. Marca tu ubicación
                  exacta en el mapa con la casilla de abajo.
                </p>
              )}

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
                  className="small"
                  onClick={() => u.setSim(true)}
                >
                  📌 Marcar mi ubicación en el mapa
                </button>
              )}

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

              <button type="submit" disabled={enviando}>
                {enviando ? 'Enviando…' : 'Solicitar atención'}
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
            <h2>📋 Mis solicitudes</h2>
            {casos.length === 0 && <p className="hint">Aún no tienes solicitudes.</p>}
            {casos.map((c) => (
              <div className="item" key={c.id}>
                <b>{ESTADO[c.estado] || c.estado}</b>{' '}
                <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                <p>{c.cuadro}</p>
                {c.medico_nombre && (
                  <p>
                    Médico: {c.medico_nombre} · {fmtKm(c.km)} km · llega en ~
                    {fmtEta(c.eta)}
                  </p>
                )}
              </div>
            ))}
          </section>
        </aside>

        <section className="center">
          <div id="map"></div>
          <p className="hint">
            🔵 Médico libre · ⚪ Médico ocupado · 🏠 Paciente · 📍 Tu ubicación
          </p>
        </section>
      </main>
    </Shell>
  );
}
