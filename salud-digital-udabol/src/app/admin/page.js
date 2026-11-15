'use client';

import { useEffect, useRef, useState } from 'react';
import Shell from '../../components/Shell';
import {
  useGuard,
  useMapa,
  useVivo,
  useMedicos,
  icono,
  dibujarRuta,
} from '../../components/hooks';
import { sb } from '../../lib/supabase';
import { asignar, URG, ll, esc, fmtKm, fmtEta } from '../../lib/geo';

export default function Admin() {
  const s = useGuard('admin');
  const mp = useMapa(true, !!s);
  const { ms } = useMedicos(mp, null, !!s);

  const [cs, setCs] = useState([]);
  const [log, setLog] = useState(['// Consola de asignación SIG…']);
  const [asignandoId, setAsignandoId] = useState(null);
  const [asignandoTodos, setAsignandoTodos] = useState(false);

  const capa = useRef(null);
  const pj = useRef('');

  const anotar = (texto) => {
    const hora = new Date().toLocaleTimeString('es-BO', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setLog((x) => [...x.slice(-4), `${hora} · ${texto}`]);
  };

  useVivo(
    'casos',
    async () => {
      const { data, error } = await sb
        .from('casos')
        .select('*')
        .neq('estado', 'finalizado');
      if (error) return;

      const serializado = JSON.stringify(data || []);
      if (serializado !== pj.current) {
        pj.current = serializado;
        setCs(data || []);
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

    cs.filter((c) => c.lat != null && c.lng != null).forEach((c) => {
      L.marker(ll(c), { icon: icono(L, 'pac', '🏠') })
        .addTo(capaActual)
        .bindPopup(
          `<b>${esc(c.nombre)}</b><br>${esc(c.cuadro)}<br>${URG[c.urg] || ''}`,
        );
      if (c.estado === 'asignado') dibujarRuta(L, capaActual, c);
    });
  }, [mp, cs]);

  async function asig(c) {
    setAsignandoId(c.id);
    try {
      const m = await asignar(c.id, c);
      anotar(
        m
          ? `✔ ${c.nombre} → ${m.nombre} (${m.esp})`
          : `⚠ ${c.nombre}: no hay médicos disponibles con ubicación.`,
      );
      return m;
    } finally {
      setAsignandoId(null);
    }
  }

  async function todos() {
    const pendientes = [...cs]
      .filter((c) => c.estado === 'pendiente')
      .sort((a, b) => a.urg - b.urg);

    setAsignandoTodos(true);
    try {
      for (const c of pendientes) {
        if (!(await asig(c))) break;
      }
    } finally {
      setAsignandoTodos(false);
    }
  }

  const ordenados = [...cs].sort((a, b) => a.urg - b.urg);
  const asignados = cs.filter((c) => c.estado === 'asignado');
  const pendientes = cs.filter((c) => c.estado === 'pendiente');

  const conEta = asignados.filter((c) => Number.isFinite(Number(c.eta)));
  const etaProm = conEta.length
    ? Math.round(
        conEta.reduce((total, c) => total + Number(c.eta), 0) / conEta.length,
      )
    : null;

  return (
    <Shell titulo="Panel del administrador" nombre={s?.p?.nombre}>
      <main className="m3">
        <aside>
          <section className="card">
            <div className="row between">
              <h2>📋 Casos activos</h2>
              <button
                type="button"
                className="small"
                onClick={todos}
                disabled={asignandoTodos || pendientes.length === 0}
              >
                {asignandoTodos ? 'Asignando…' : 'Asignar pendientes'}
              </button>
            </div>

            {cs.length === 0 && <p className="hint">Sin casos activos.</p>}

            {ordenados.map((c) => (
              <div className="item" key={c.id}>
                <b>{c.nombre}</b>{' '}
                <span className={`tag u${c.urg}`}>{URG[c.urg] || '—'}</span>
                <p>
                  {c.cuadro} · {c.esp}
                </p>
                {c.estado === 'asignado' ? (
                  <p>
                    → {c.medico_nombre || 'Médico'} · {fmtKm(c.km)} km ·{' '}
                    {fmtEta(c.eta)}
                  </p>
                ) : (
                  <div className="row">
                    <button
                      type="button"
                      className="small"
                      onClick={() => asig(c)}
                      disabled={asignandoTodos || asignandoId === c.id}
                    >
                      {asignandoId === c.id ? 'Asignando…' : 'Asignar médico'}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </section>
        </aside>

        <section className="center">
          <div className="stats">
            <div>
              <b>{ms.filter((m) => m.libre && m.lat != null).length}</b>
              <span>Médicos libres</span>
            </div>
            <div>
              <b>{pendientes.length}</b>
              <span>Casos pendientes</span>
            </div>
            <div>
              <b>{fmtEta(etaProm)}</b>
              <span>ETA promedio</span>
            </div>
          </div>

          <div id="map"></div>

          <div className="log" aria-live="polite">
            {log.map((linea, i) => (
              <div key={i}>{linea}</div>
            ))}
          </div>
        </section>

        <aside>
          <section className="card">
            <h2>👨‍⚕️ Personal médico</h2>
            {ms.length === 0 && <p className="hint">Aún no hay médicos registrados.</p>}
            {ms.map((m) => (
              <div className="item" key={m.id}>
                <b>{m.nombre}</b>
                <p>{m.esp}</p>
                <p>
                  {m.lat == null
                    ? '⚠ Sin ubicación'
                    : m.libre
                      ? '🟢 Disponible'
                      : '🔴 No disponible / en atención'}
                </p>
              </div>
            ))}
          </section>
        </aside>
      </main>
    </Shell>
  );
}
