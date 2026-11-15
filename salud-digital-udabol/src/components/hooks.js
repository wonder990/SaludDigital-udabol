'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb } from '../lib/supabase';
import { km, ll, esc, parseRuta } from '../lib/geo';

// Acción "Mi ubicación" asociada a cada mapa. Se guarda fuera del objeto del
// mapa para no mutar valores que React considera de solo lectura.
const accionesUbicacion = new WeakMap();

export const icono = (L, cls, emoji) =>
  L.divIcon({
    html: `<div class="pin ${cls}">${emoji}</div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

export const dibujarRuta = (L, capa, caso) => {
  const puntos = parseRuta(caso?.ruta);
  if (!puntos) return null;
  return L.polyline(puntos, {
    color: '#2563eb',
    weight: 4,
    dashArray: caso.tipo_ruta === 'línea recta' ? '8,8' : null,
  }).addTo(capa);
};

// Motivo real del fallo del GPS (código del navegador)
const msgGps = (c) =>
  c === 1
    ? 'Permiso de ubicación denegado. Pulsa el candado junto a la dirección de la página y permite la Ubicación.'
    : c === 2
      ? 'Windows no pudo darte la ubicación: activa “Servicios de ubicación” en Configuración → Privacidad y seguridad → Ubicación.'
      : 'Tu equipo no entregó la ubicación a tiempo. Marca tu ubicación exacta en el mapa.';

// Si la precisión es peor que esto (1 km), es una ubicación por red/IP y no
// sirve para enviar un médico a un domicilio. En ese caso no se usa.
const PRECISION_MAX = 1000;

/**
 * Protege una página: exige sesión y el rol indicado.
 * @returns {{u: object, p: object}|null} usuario de Auth y perfil de la tabla usuarios.
 */
export function useGuard(rol) {
  const router = useRouter();
  const [sesion, setSesion] = useState(null);

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        if (cancelado) return;

        if (!session) {
          router.replace('/?m=sin-sesion');
          return;
        }

        const { data: perfil, error } = await sb
          .from('usuarios')
          .select('*')
          .eq('id', session.user.id)
          .maybeSingle();

        if (cancelado) return;
        if (error) {
          router.replace('/?m=error-' + encodeURIComponent(error.message));
          return;
        }
        if (!perfil) {
          router.replace('/?m=sin-perfil');
          return;
        }
        if (perfil.rol !== rol) {
          router.replace('/?m=rol-' + perfil.rol);
          return;
        }

        setSesion({ u: session.user, p: perfil });
      } catch (e) {
        if (!cancelado) {
          router.replace('/?m=error-' + encodeURIComponent(e.message));
        }
      }
    })();

    return () => {
      cancelado = true;
    };
  }, [rol, router]);

  return sesion;
}

/**
 * Crea el mapa Leaflet en el elemento con id="map".
 * @param {boolean} marcarme dibuja un marcador con la ubicación del navegador.
 * @param {boolean} activo solo crea el mapa cuando la sesión está verificada.
 * @returns {{map: object, L: object}|null}
 */
export function useMapa(marcarme = false, activo = true) {
  const [mapa, setMapa] = useState(null);

  useEffect(() => {
    if (!activo) return;

    let cancelado = false;
    let map = null;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelado) return;

      const contenedor = document.getElementById('map');
      if (!contenedor) return;

      map = L.map(contenedor).setView([-17.9667, -67.1167], 14);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map);

      // Botón "Mi ubicación" + centrado automático al abrir.
      let yoMk = null;
      const centrar = () => {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
          (p) => {
            if (cancelado || !map) return;
            // No se centra ni se marca con ubicaciones por red/IP (±km).
            const acc = p.coords.accuracy;
            if (acc != null && acc > PRECISION_MAX) return;
            const c = [p.coords.latitude, p.coords.longitude];
            map.setView(c, 15);
            if (marcarme) {
              if (yoMk) map.removeLayer(yoMk);
              yoMk = L.marker(c, { icon: icono(L, 'sel', '📍') })
                .addTo(map)
                .bindPopup('Tú estás aquí');
            }
          },
          () => {
            // Sin alertas bloqueantes: el panel ya muestra el estado del GPS.
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
        );
      };

      const Ctl = L.Control.extend({
        onAdd() {
          const b = L.DomUtil.create('button', 'boton-ubic');
          b.type = 'button';
          b.textContent = '📍 Mi ubicación';
          L.DomEvent.disableClickPropagation(b);
          b.onclick = () => {
            const accion = accionesUbicacion.get(map);
            if (accion) accion();
            else centrar();
          };
          return b;
        },
      });
      new Ctl({ position: 'topright' }).addTo(map);

      if (marcarme) centrar();
      setMapa({ map, L });
    })();

    return () => {
      cancelado = true;
      if (map) {
        accionesUbicacion.delete(map);
        map.remove();
        map = null;
      }
    };
  }, [marcarme, activo]);

  return mapa;
}

/**
 * Tiempo real: suscripción de Supabase + recarga periódica como respaldo
 * (si Realtime no está habilitado en el proyecto, la vista igual se actualiza).
 */
export function useVivo(tabla, cargar, activo = true) {
  const ref = useRef(cargar);

  useEffect(() => {
    ref.current = cargar;
  }, [cargar]);

  useEffect(() => {
    if (!activo) return;

    let canal;
    let cancelado = false;
    let intervalo;

    (async () => {
      try {
        const {
          data: { session },
        } = await sb.auth.getSession();
        if (cancelado) return;

        if (session) await sb.realtime.setAuth(session.access_token);
        await ref.current();
        if (cancelado) return;

        canal = sb
          .channel('rt-' + tabla + '-' + Math.random().toString(36).slice(2))
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: tabla },
            () => {
              Promise.resolve(ref.current()).catch(() => {});
            },
          )
          .subscribe();
      } catch {
        // El respaldo por intervalo mantiene la vista actualizada.
      }
    })();

    const ejecutar = () => {
      Promise.resolve(ref.current()).catch(() => {});
    };
    intervalo = setInterval(ejecutar, 4000);

    return () => {
      cancelado = true;
      clearInterval(intervalo);
      if (canal) sb.removeChannel(canal);
    };
  }, [tabla, activo]);
}

/** Todos los médicos registrados, dibujados en el mapa. */
export function useMedicos(mapa, excluirId, activo = true) {
  const [medicos, setMedicos] = useState([]);
  const capa = useRef(null);
  const anterior = useRef('');

  const recargar = useCallback(async () => {
    const { data, error } = await sb
      .from('usuarios')
      .select('*')
      .eq('rol', 'medico');
    if (error) return;

    const lista = data || [];
    const serializado = JSON.stringify(lista);
    if (serializado !== anterior.current) {
      anterior.current = serializado;
      setMedicos(lista);
    }
  }, []);

  useVivo('usuarios', recargar, activo);

  useEffect(() => {
    if (!mapa) return;
    const { L, map } = mapa;

    if (!capa.current) capa.current = L.layerGroup().addTo(map);
    const capaActual = capa.current;
    capaActual.clearLayers();

    medicos
      .filter((m) => m.id !== excluirId && m.lat != null && m.lng != null)
      .forEach((m) => {
        L.marker(ll(m), {
          icon: icono(L, 'med' + (m.libre ? '' : ' busy'), '👨‍⚕️'),
        })
          .addTo(capaActual)
          .bindPopup(
            `<b>${esc(m.nombre)}</b><br>${esc(m.esp)}<br>${
              m.libre ? '🟢 Libre' : '🔴 Ocupado'
            }`,
          );
      });
  }, [mapa, medicos, excluirId]);

  return { ms: medicos, recargar };
}

/**
 * GPS en tiempo real (actualiza si se movió >30 m y pasaron >5 s).
 * Las lecturas con precisión peor que PRECISION_MAX se descartan.
 * Marcado manual: con `sim` activo, un clic en el mapa fija la ubicación.
 *
 * @param {{map: object, L: object}|null} mapa
 * @param {(pos: {lat:number,lng:number}|null) => void} onPos
 * @param {boolean} marcador dibuja el marcador de la posición actual
 * @param {boolean} activo solo pide GPS cuando la sesión está verificada
 */
export function useUbicacion(mapa, onPos, marcador, activo = true) {
  const [txt, setTxt] = useState('📡 Obteniendo tu ubicación…');
  const [sim, setSim] = useState(false);
  const [prec, setPrec] = useState(null);
  const [falloGps, setFalloGps] = useState(false);
  const estado = useRef({
    ult: null,
    t0: 0,
    mk: null,
    sim: false,
    simulado: false,
    real: null,
    prec: null,
    respaldo: false,
    forzar: null,
    limpiar: null,
  });
  const onPosRef = useRef(onPos);

  useEffect(() => {
    onPosRef.current = onPos;
  }, [onPos]);

  useEffect(() => {
    if (!mapa || !activo) return;
    const { map, L } = mapa;
    const s = estado.current;

    const fijar = (la, ln, centrar, precision) => {
      setPrec(precision ?? null);
      setFalloGps(false);
      setTxt(
        precision != null
          ? precision > 1000
            ? `⚠ Ubicación aproximada: ${la.toFixed(4)}, ${ln.toFixed(4)} (±${Math.round(
                precision / 1000,
              )} km)`
            : `✔ Ubicación REAL: ${la.toFixed(4)}, ${ln.toFixed(4)} (±${Math.round(
                precision,
              )} m)`
          : `📍 Ubicación marcada en el mapa: ${la.toFixed(4)}, ${ln.toFixed(4)}`,
      );
      if (marcador) {
        if (s.mk) map.removeLayer(s.mk);
        s.mk = L.marker([la, ln], { icon: icono(L, 'sel', '📍') })
          .addTo(map)
          .bindPopup('Tú estás aquí');
      }
      if (centrar) map.setView([la, ln], 15);
      s.ult = [la, ln];
      s.t0 = Date.now();
      s.prec = precision ?? null;
      onPosRef.current?.({ lat: la, lng: ln });
    };

    let watch = null;

    const limpiar = () => {
      if (s.mk) {
        map.removeLayer(s.mk);
        s.mk = null;
      }
      s.ult = null;
      s.simulado = false;
      s.prec = null;
      setPrec(null);
      onPosRef.current?.(null);
    };

    const manejar = (p) => {
      const la = p.coords.latitude;
      const ln = p.coords.longitude;
      const acc = p.coords.accuracy;
      s.real = [la, ln, acc];
      if (s.sim) return;

      // Ubicación por red/IP (±kilómetros): no se dibuja ni se usa como
      // domicilio. Se pide marcarla manualmente en el mapa.
      if (acc != null && acc > PRECISION_MAX) {
        if (s.prec != null && s.prec <= PRECISION_MAX) return;
        if (s.ult) limpiar();
        setPrec(acc);
        setFalloGps(true);
        setTxt(
          `⚠ Windows solo pudo ubicarte por red (±${Math.round(
            acc / 1000,
          )} km): este equipo no tiene GPS ni Wi-Fi. Marca tu ubicación exacta en el mapa.`,
        );
        return;
      }

      // Si la nueva lectura es mucho más precisa (p. ej. pasa de ±50 km por
      // red a ±20 m por GPS), se acepta aunque no haya habido movimiento.
      const mejora =
        acc != null && (s.prec == null || acc < s.prec * 0.7);
      if (
        !mejora &&
        s.ult &&
        (km(s.ult, [la, ln]) < 0.03 || Date.now() - s.t0 < 5000)
      ) {
        return;
      }
      fijar(la, ln, !s.ult, acc);
    };

    const fallo = (e) => {
      setFalloGps(true);
      if (!s.ult) setTxt('⚠ ' + msgGps(e.code));
      // Si la lectura de alta precisión falla (equipo sin GPS/Wi-Fi), se pide
      // una sola lectura de baja precisión: así al menos se informa el motivo
      // real (±km por red) en vez de dejarlo en "obteniendo…".
      if (!s.respaldo && navigator.geolocation) {
        s.respaldo = true;
        navigator.geolocation.getCurrentPosition(manejar, () => {}, {
          enableHighAccuracy: false,
          timeout: 10000,
          maximumAge: 300000,
        });
      }
    };

    if (!navigator.geolocation) {
      queueMicrotask(() => setTxt('⚠ Tu navegador no soporta GPS'));
    } else {
      // La primera lectura también pide alta precisión: sin esto Chrome suele
      // devolver una ubicación aproximada por red (±kilómetros).
      navigator.geolocation.getCurrentPosition(manejar, fallo, {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 0,
      });
      watch = navigator.geolocation.watchPosition(manejar, fallo, {
        enableHighAccuracy: true,
        maximumAge: 10000,
        timeout: 30000,
      });
    }

    const click = (e) => {
      if (!s.sim) return;
      s.simulado = true;
      fijar(e.latlng.lat, e.latlng.lng, false);
    };
    map.on('click', click);

    // Vuelve a la ubicación REAL: sale del modo manual/simulación.
    const forzar = () => {
      setSim(false);
      s.sim = false;
      limpiar(); // el punto marcado a mano desaparece de inmediato

      if (s.real && s.real[2] != null && s.real[2] <= PRECISION_MAX) {
        fijar(s.real[0], s.real[1], true, s.real[2]);
        return;
      }

      setTxt('📡 Obteniendo tu ubicación real…');
      if (!navigator.geolocation) {
        setTxt('⚠ Tu navegador no soporta GPS');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (p) => {
          const acc = p.coords.accuracy;
          if (acc != null && acc > PRECISION_MAX) {
            setPrec(acc);
            setFalloGps(true);
            setTxt(
              `⚠ Ubicación aproximada (±${Math.round(
                acc / 1000,
              )} km). Marca tu ubicación exacta en el mapa o activa la ubicación precisa del sistema.`,
            );
            return;
          }
          fijar(p.coords.latitude, p.coords.longitude, true, acc);
        },
        (e) => {
          setFalloGps(true);
          setTxt('⚠ ' + msgGps(e.code));
          // Respaldo: lectura de baja precisión para informar el motivo real.
          navigator.geolocation.getCurrentPosition(manejar, () => {}, {
            enableHighAccuracy: false,
            timeout: 10000,
            maximumAge: 300000,
          });
        },
        {
          enableHighAccuracy: true,
          timeout: 8000,
          maximumAge: 0,
        },
      );
    };

    s.forzar = forzar;
    s.limpiar = limpiar;
    accionesUbicacion.set(map, forzar);

    return () => {
      if (accionesUbicacion.get(map) === forzar) accionesUbicacion.delete(map);
      if (watch != null) navigator.geolocation.clearWatch(watch);
      map.off('click', click);
      if (s.mk) {
        map.removeLayer(s.mk);
        s.mk = null;
      }
      s.forzar = null;
      s.limpiar = null;
    };
  }, [mapa, marcador, activo]);

  // Activa/desactiva el marcado manual de la ubicación en el mapa.
  const cambiarSim = useCallback((valor) => {
    setSim(valor);
    estado.current.sim = valor;
    if (valor) {
      estado.current.limpiar?.();
      setTxt('📍 Haz clic en el mapa para marcar tu ubicación exacta');
    } else if (estado.current.forzar) {
      estado.current.forzar();
    }
  }, []);

  // Fuerza una nueva lectura GPS de alta precisión y sale del marcado manual.
  const reubicar = useCallback(() => {
    if (estado.current.forzar) estado.current.forzar();
    else setTxt('📡 Esperando el mapa para obtener tu ubicación…');
  }, []);

  return {
    txt,
    sim,
    setSim: cambiarSim,
    reubicar,
    prec,
    falloGps,
    aprox: prec != null && prec > 1000,
  };
}
