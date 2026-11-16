'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { sb, SUPABASE_URL } from '../lib/supabase';
import { CENTROS } from '../lib/centros';

const PAGINA = { paciente: '/paciente', hospital: '/hospital' };
const ROLES = ['paciente', 'hospital'];
const KEY = 'saludmovil_registro'; // datos del registro mientras el usuario pasa por Google
const VACIO = { nombre: '', rol: 'paciente', centro: '', otro: '' };
const OTRO = '__otro__'; // opción "Otro centro" del selector de hospital

function leerPendiente() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

function guardarPendiente(datos) {
  try {
    localStorage.setItem(KEY, JSON.stringify(datos));
    return true;
  } catch {
    return false;
  }
}

function borrarPendiente() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // El navegador puede bloquear el almacenamiento; no es crítico.
  }
}

function normalizarPendiente(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    nombre: String(p.nombre ?? ''),
    rol: ROLES.includes(p.rol) ? p.rol : 'paciente',
    centro: String(p.centro ?? ''),
    otro: String(p.otro ?? ''),
  };
}

/** Nombre final del hospital según la elección en el registro. */
function nombreHospital(f) {
  return f.centro === OTRO ? f.otro.trim() : f.centro;
}

function validar(f) {
  if (!f || typeof f !== 'object') {
    return 'Los datos de registro no son válidos.';
  }
  if (!ROLES.includes(f.rol)) return 'Selecciona un rol válido.';
  if (f.rol === 'hospital') {
    if (!f.centro) return 'Selecciona tu centro de salud.';
    if (f.centro === OTRO && f.otro.trim().length < 2) {
      return 'Escribe el nombre de tu centro de salud.';
    }
  } else if (f.nombre.trim().length < 2) {
    return 'Escribe un nombre de usuario de al menos 2 caracteres.';
  }
  return '';
}

function textoMotivo(motivo) {
  if (!motivo) return '';
  if (motivo === 'sin-sesion') return 'Inicia sesión para continuar.';
  if (motivo === 'sin-perfil') {
    return 'Tu cuenta aún no tiene un perfil. Completa el registro.';
  }
  if (motivo.startsWith('rol-')) {
    return `Tu cuenta tiene el rol "${motivo.slice(4)}" y no puede entrar a esa sección.`;
  }
  if (motivo.startsWith('error-')) {
    return 'No se pudo verificar tu sesión: ' + motivo.slice(6);
  }
  return '';
}

export default function Login() {
  const router = useRouter();
  const [vista, setVista] = useState('cargando'); // cargando · inicio · perfil
  const [session, setSession] = useState(null);
  const [reg, setReg] = useState(false);
  const [f, setF] = useState(VACIO);
  const [m, setM] = useState({ t: '', ok: false });
  const [conexion, setConexion] = useState(null); // null · 'ok' · 'error'
  const [diag, setDiag] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [redirigiendo, setRedirigiendo] = useState(false);
  const [correo, setCorreo] = useState(false); // formulario de correo y contraseña
  const [cred, setCred] = useState({ email: '', pass: '' });
  const [entrando, setEntrando] = useState(false);

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setC = (k) => (e) => setCred((x) => ({ ...x, [k]: e.target.value }));
  const d = useCallback((t) => setDiag((x) => x + t + '\n'), []);
  const err = useCallback((t) => setM({ t, ok: false }), []);

  // Crea el perfil (nombre de usuario + rol) de la cuenta de Google.
  const crearPerfil = useCallback(
    async (ses, datos) => {
      if (!ses?.user?.id) {
        err('La sesión no es válida. Vuelve a iniciar sesión.');
        return false;
      }
      const mal = validar(datos);
      if (mal) {
        err(mal);
        return false;
      }

      const nombreFinal = datos.rol === 'hospital' ? nombreHospital(datos) : datos.nombre.trim();

      const { error } = await sb.from('usuarios').insert({
        id: ses.user.id,
        nombre: nombreFinal,
        email: ses.user.email ?? '',
        rol: datos.rol,
        esp: null,
        libre: false,
      });

      if (error) {
        err('No se pudo crear el perfil: ' + error.message);
        return false;
      }

      borrarPendiente();
      router.replace(PAGINA[datos.rol]);
      return true;
    },
    [err, router],
  );

  // Al volver de Google: entra a su panel o completa/crea el perfil.
  const resolver = useCallback(
    async (ses) => {
      d(`Sesión: ${ses.user.email} (id ${ses.user.id.slice(0, 8)}…)`);

      const pendiente = normalizarPendiente(leerPendiente());

      const r = await sb
        .from('usuarios')
        .select('*')
        .eq('id', ses.user.id)
        .maybeSingle();

      if (r.error) {
        d('Error al leer tu perfil: ' + r.error.message);
        err('No se pudo leer tu perfil: ' + r.error.message);
        setVista('inicio');
        return;
      }

      let perfil = r.data;
      d(perfil ? `Perfil por id: rol ${perfil.rol}` : 'Perfil por id: no existe');

      if (!perfil && ses.user.email) {
        // Se registró antes con este mismo correo pero otro id: se enlaza.
        const r2 = await sb
          .from('usuarios')
          .select('*')
          .eq('email', ses.user.email)
          .limit(1)
          .maybeSingle();

        if (r2.error) d('Error buscando por correo: ' + r2.error.message);
        const anterior = r2.data;
        d(
          anterior
            ? `Perfil por correo: rol ${anterior.rol} (id ${anterior.id.slice(0, 8)}…)`
            : 'Perfil por correo: no existe',
        );

        if (anterior) {
          const u = await sb
            .from('usuarios')
            .update({ id: ses.user.id })
            .eq('id', anterior.id);

          if (!u.error) {
            perfil = { ...anterior, id: ses.user.id };
          } else {
            // Si la actualización de la clave falla (por claves foráneas),
            // se crea una copia del perfil con el id nuevo.
            const ins = await sb.from('usuarios').insert({
              id: ses.user.id,
              nombre: anterior.nombre,
              email: anterior.email,
              rol: anterior.rol,
              esp: null,
              libre: false,
            });
            if (!ins.error) perfil = { ...anterior, id: ses.user.id };
            else {
              d('No se pudo enlazar: ' + u.error.message);
              err('No se pudo enlazar tu cuenta anterior: ' + u.error.message);
            }
          }
        }
      }

      if (perfil) {
        const destino = ROLES.includes(perfil.rol) ? PAGINA[perfil.rol] : '/';
        if (!pendiente) {
          router.replace(destino);
          return;
        }
        borrarPendiente();
        setVista('inicio');
        setM({
          t: `✔ Esta cuenta de Google ya estaba registrada como ${perfil.rol}. Entrando…`,
          ok: true,
        });
        setTimeout(() => router.replace(destino), 1500);
        return;
      }

      if (pendiente) {
        const creado = await crearPerfil(ses, pendiente);
        if (!creado) {
          setSession(ses);
          setF(pendiente);
          setVista('perfil');
        }
        return;
      }

      setF((x) => ({
        ...x,
        nombre: ses.user.user_metadata?.full_name || '',
      }));
      setSession(ses);
      setVista('perfil'); // entró con Google sin haberse registrado
    },
    [crearPerfil, d, err, router],
  );

  const ya = useRef(false);

  useEffect(() => {
    // Mensajes que dejan las páginas al redirigir al inicio.
    queueMicrotask(() => {
      const q = new URLSearchParams(
        location.search + '&' + location.hash.slice(1),
      );
      if (q.get('m')) {
        const motivo = q.get('m');
        d('Un panel te devolvió al inicio: ' + motivo);
        const texto = textoMotivo(motivo);
        if (texto) setM({ t: texto, ok: false });
      }
      if (q.get('error_description')) {
        d('Error de Google/Supabase: ' + q.get('error_description'));
        err(q.get('error_description'));
      }
    });

    // Verificación de conectividad: si el proyecto de Supabase no existe o no
    // hay red, el usuario ve un aviso claro en lugar de un error silencioso.
    if (SUPABASE_URL && typeof fetch === 'function') {
      const signal =
        typeof AbortSignal !== 'undefined' &&
        typeof AbortSignal.timeout === 'function'
          ? AbortSignal.timeout(8000)
          : undefined;

      fetch(SUPABASE_URL + '/auth/v1/health', {
        mode: 'no-cors',
        cache: 'no-store',
        signal,
      })
        .then(() => setConexion('ok'))
        .catch(() => {
          d('No se pudo contactar Supabase en ' + SUPABASE_URL);
          setConexion('error');
        });
    }

    const { data: sub } = sb.auth.onAuthStateChange((ev, ses) => {
      if (ev === 'SIGNED_OUT') {
        ya.current = false;
        setVista('inicio');
        return;
      }
      if (ev !== 'INITIAL_SESSION' && ev !== 'SIGNED_IN') return;
      if (!ses) {
        setVista('inicio');
        return;
      }
      if (ya.current) return;
      ya.current = true;
      // Fuera del callback para evitar bloqueos de Supabase.
      setTimeout(() => resolver(ses), 0);
    });

    // Si Supabase no responde, no dejamos la pantalla en "Cargando…".
    const respaldo = setTimeout(() => {
      setVista((v) => (v === 'cargando' ? 'inicio' : v));
    }, 5000);

    return () => {
      clearTimeout(respaldo);
      sub.subscription.unsubscribe();
    };
  }, [d, err, resolver]);

  // Ingreso con cuentas demo (correo y contraseña creadas en Supabase).
  async function entrarCorreo(e) {
    e.preventDefault();
    setEntrando(true);
    setM({ t: '', ok: false });

    const { error } = await sb.auth.signInWithPassword({
      email: cred.email.trim(),
      password: cred.pass,
    });

    if (error) {
      const texto =
        error.message === 'Invalid login credentials'
          ? 'Correo o contraseña incorrectos.'
          : error.message;
      err(texto);
      setEntrando(false);
      return;
    }
    // Sin error: el evento SIGNED_IN dispara resolver() y redirige al panel.
  }

  function google() {
    setM({ t: '', ok: false });

    if (reg) {
      const mal = validar(f);
      if (mal) return err(mal);
      if (!guardarPendiente(f)) {
        return err('No se pudo guardar el registro en este navegador. Revisa la configuración de almacenamiento.');
      }
    } else {
      borrarPendiente();
    }

    setRedirigiendo(true);
    sb.auth
      .signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
          queryParams: { prompt: 'select_account' },
        },
      })
      .then(({ error }) => {
        if (error) {
          setRedirigiendo(false);
          err(error.message);
        }
      })
      .catch((e) => {
        setRedirigiendo(false);
        err(e.message);
      });
  }

  async function guardar(e) {
    e.preventDefault();
    if (!session) return;
    const mal = validar(f);
    if (mal) return err(mal);

    setGuardando(true);
    setM({ t: '', ok: false });
    const creado = await crearPerfil(session, f);
    if (!creado) setGuardando(false);
  }

  const cancelar = async () => {
    await sb.auth.signOut();
    ya.current = false;
    setSession(null);
    setVista('inicio');
  };

  const campos = (
    <>
      {f.rol === 'paciente' ? (
        <>
          <label className="sr-only" htmlFor="nombre">
            Nombre de usuario
          </label>
          <input
            id="nombre"
            placeholder="Nombre de usuario"
            autoComplete="name"
            maxLength={60}
            value={f.nombre}
            onChange={set('nombre')}
          />
        </>
      ) : null}

      <label className="sr-only" htmlFor="rol">
        Rol
      </label>
      <select id="rol" value={f.rol} onChange={set('rol')}>
        <option value="paciente">Soy paciente</option>
        <option value="hospital">Soy hospital / centro de salud</option>
      </select>

      {f.rol === 'hospital' && (
        <>
          <label className="sr-only" htmlFor="centro">
            Centro de salud
          </label>
          <select id="centro" value={f.centro} onChange={set('centro')}>
            <option value="">Elige tu centro…</option>
            {CENTROS.map((c) => (
              <option key={c.id} value={c.nombre}>
                {c.nombre}
              </option>
            ))}
            <option value={OTRO}>Otro centro (escribir nombre)</option>
          </select>

          {f.centro === OTRO && (
            <>
              <label className="sr-only" htmlFor="otro">
                Nombre del centro de salud
              </label>
              <input
                id="otro"
                placeholder="Nombre del centro de salud"
                maxLength={80}
                value={f.otro}
                onChange={set('otro')}
              />
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <>
      <header>
        <div>
          <h1>
            <span
              className="flag-bo"
              role="img"
              aria-label="Bandera de Bolivia"
            />
            SaludMóvil Bolivia
          </h1>
          <small>Emergencias médicas · SIG</small>
        </div>
      </header>

      <div className="mx-auto mt-10 w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        {conexion === 'error' && (
          <p className="err mb-3" role="alert">
            No se pudo conectar con Supabase. Revisa NEXT_PUBLIC_SUPABASE_URL y
            tu conexión.
          </p>
        )}

        {vista === 'cargando' && <p className="hint text-center">Cargando…</p>}

        {vista === 'inicio' && (
          <div className="flex flex-col gap-2">
            <div className="mb-2 flex gap-2">
              <button
                type="button"
                className={`flex-1 ${reg ? 'ghost' : ''}`}
                aria-pressed={!reg}
                onClick={() => {
                  setReg(false);
                  setM({ t: '', ok: false });
                }}
              >
                Ingresar
              </button>
              <button
                type="button"
                className={`flex-1 ${reg ? '' : 'ghost'}`}
                aria-pressed={reg}
                onClick={() => {
                  setReg(true);
                  setM({ t: '', ok: false });
                }}
              >
                Registrarse
              </button>
            </div>

            {reg && campos}

            <p className={m.ok ? 'ok' : 'err'} role="status" aria-live="polite">
              {m.t}
            </p>

            <button
              type="button"
              onClick={google}
              disabled={redirigiendo}
              className="!flex items-center justify-center gap-2 border !border-slate-300 !bg-white !text-slate-700 hover:!bg-slate-50"
            >
              <span className="text-lg font-bold text-blue-600">G</span>{' '}
              {redirigiendo
                ? 'Redirigiendo a Google…'
                : reg
                  ? 'Registrarse con Google'
                  : 'Ingresar con Google'}
            </button>

            {!reg && !correo && (
              <button
                type="button"
                className="ghost small"
                onClick={() => {
                  setCorreo(true);
                  setM({ t: '', ok: false });
                }}
              >
                Ingresar con correo y contraseña
              </button>
            )}

            {!reg && correo && (
              <form onSubmit={entrarCorreo} className="flex flex-col gap-2">
                <label className="sr-only" htmlFor="correo">
                  Correo
                </label>
                <input
                  id="correo"
                  type="email"
                  placeholder="Correo"
                  autoComplete="username"
                  value={cred.email}
                  onChange={setC('email')}
                  required
                />
                <label className="sr-only" htmlFor="contra">
                  Contraseña
                </label>
                <input
                  id="contra"
                  type="password"
                  placeholder="Contraseña"
                  autoComplete="current-password"
                  value={cred.pass}
                  onChange={setC('pass')}
                  required
                />
                <button type="submit" disabled={entrando}>
                  {entrando ? 'Entrando…' : 'Ingresar'}
                </button>
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => {
                    setCorreo(false);
                    setM({ t: '', ok: false });
                  }}
                >
                  Cancelar
                </button>
              </form>
            )}

            <p className="hint text-center">
              {reg
                ? 'El registro se realiza con tu cuenta de Google.'
                : 'Ingresa con tu cuenta de Google o con tu cuenta de correo.'}
            </p>
          </div>
        )}

        {vista === 'perfil' && session && (
          <form onSubmit={guardar}>
            <h2 className="!mb-0 text-lg">Completa tu registro</h2>
            <p className="hint mb-2">Cuenta de Google: {session.user.email}</p>
            {campos}
            <p className={m.ok ? 'ok' : 'err'} role="status" aria-live="polite">
              {m.t}
            </p>
            <button type="submit" disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar y entrar'}
            </button>
            <button
              type="button"
              className="ghost"
              onClick={cancelar}
              disabled={guardando}
            >
              Cancelar
            </button>
          </form>
        )}
      </div>

      {diag && (
        <details className="mx-auto mt-4 w-full max-w-sm text-[11px] text-slate-500">
          <summary className="cursor-pointer select-none">Diagnóstico técnico</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono leading-5">{diag}</pre>
        </details>
      )}
    </>
  );
}
