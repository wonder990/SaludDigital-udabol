'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
  URG,
  ll,
  parseRuta,
  fmtKm,
  fmtEta,
} from '../../lib/geo';

export default function Medico() {
  const s = useGuard('medico');
  const mp = useMapa(false, !!s);
  const id = s?.u?.id;

  const { ms, recargar } = useMedicos(mp, id, !!s);
  const perfil = ms.find((m) => m.id === id) || s?.p || null;
  const miLat = perfil?.lat ?? null;
  const miLng = perfil?.lng ?? null;
  const libre = !!perfil?.libre;
  const tiene = miLat != null && miLng != null;

  const [casos, setCasos] = useState([]);
  const capa = useRef(null);
  const n = useRef(0);
  const posRef = useRef(null);
  const pj = useRef('');
  const lis = useRef(false); // ya se descartó la ubicación guardada de la sesión anterior
  const perfilRef = useRef(perfil);

  const ocup = casos.length > 0;

  useEffect(() => {
    perfilRef.current = perfil;
  }, [perfil]);

  const yo = useCallback(
    async (campos) => {
      if (!id) return;
      return sb.from('usuarios').update(campos).eq('id', id);
    },
    [id],
  );

  // Atiende casos que quedaron en espera apenas el médico queda disponible.
  const pend = useCallback(async () => {
    const { data } = await sb
      .from('casos')
      .select('*')
      .eq('estado', 'pendiente')
      .order('urg')
      .order('creado');

    for (const c of data || []) {
      if (!(await asignar(c.id, c))) break;
    }
  }, []);

  const guardarPos = useCallback(
    async (c) => {
      // c = null: se borró la ubicación simulada.
      await yo(c ? { lat: c.lat, lng: c.lng } : { lat: null, lng: null, libre: false });
      await recargar();
      if (c && perfilRef.current?.libre) await pend();
    },
    [yo, recargar, pend],
  );

  const alUbicar = useCallback(
    (c) => {
      posRef.current = c;
      if (s && lis.current) guardarPos(c);
    },
    [s, guardarPos],
  );

  const u = useUbicacion(mp, alUbicar, false, !!s);

  useEffect(() => {
    if (!s) return;
    let cancelado = false;

    (async () => {
      // Al entrar se descarta la ubicación guardada antes (por ejemplo una
      // simulada) y se usa la ubicación actual del dispositivo.
      await yo({ lat: null, lng: null });
      if (cancelado) return;
      lis.current = true;
      if (posRef.current) await guardarPos(posRef.current);
    })();

    return () => {
      cancelado = true;
    };
  }, [s, yo, guardarPos]);

  useVivo(
    'casos',
    async () => {
      if (!id) return;
      const { data, error } = await sb
        .from('casos')
        .select('*')
        .eq('medico_id', id)
        .eq('estado', 'asignado');
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

    if (miLat != null && miLng != null) {
      L.marker([miLat, miLng], { icon: icono(L, 'med', '👨‍⚕️') }).addTo(capaActual);
    }

    casos
      .filter((c) => c.lat != null && c.lng != null)
      .forEach((c) => {
        L.marker(ll(c), { icon: icono(L, 'pac', '🏠') })
          .addTo(capaActual)
          .bindPopup(String(c.nombre ?? ''));
        dibujarRuta(L, capaActual, c);
      });

    if (casos.length > n.current) {
      const puntos = parseRuta(casos[0]?.ruta);
      if (puntos) map.fitBounds(puntos, { padding: [50, 50] });
    }
    n.current = casos.length;
  }, [mp, casos, miLat, miLng]);

  async function disp(e) {
    const valor = e.target.checked;
    if (!tiene) return;
    await yo({ libre: valor });
    await recargar();
    if (valor) await pend();
  }

  async function finalizar(cid) {
    if (!window.confirm('¿Finalizar esta atención?')) return;

    const { error } = await sb
      .from('casos')
      .update({ estado: 'finalizado' })
      .eq('id', cid)
      .eq('medico_id', id);

    if (error) {
      window.alert('No se pudo finalizar la atención: ' + error.message);
      return;
    }

    setCasos((x) => x.filter((c) => c.id !== cid));
    await yo({ libre: true });
    await recargar();
    await pend();
  }

  return (
    <Shell titulo="Panel del médico" nombre={s?.p?.nombre}>
      <main className="m2">
        <aside>
          <section className="card">
            <h2>👨‍⚕️ Mi estado</h2>
            <p className="hint">
              {!tiene
                ? '⚠ Esperando tu ubicación (activa el GPS)'
                : ocup
                  ? '🚑 En atención'
                  : libre
                    ? '🟢 Disponible'
                    : '⚪ No disponible'}
            </p>

            <label className="hint">
              <input
                type="checkbox"
                checked={libre}
                disabled={!tiene || ocup}
                onChange={disp}
              />{' '}
              Disponible para nuevos casos
            </label>

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
                Haz clic en el mapa para marcar tu ubicación exacta.
              </p>
            )}
          </section>

          <section className="card">
            <h2>📋 Casos asignados</h2>
            {casos.length === 0 && <p className="hint">Sin casos asignados.</p>}
            {casos.map((c) => (
              <div className="item" key={c.id}>
                <b>{c.nombre}</b>{' '}
                <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                <p>{c.cuadro}</p>
                <p>
                  {fmtKm(c.km)} km · ~{fmtEta(c.eta)}
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
