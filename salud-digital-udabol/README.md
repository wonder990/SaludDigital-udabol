# SaludMóvil Bolivia 🩺🇧🇴

Plataforma de **atención médica domiciliaria** con asignación inteligente de médicos y seguimiento en tiempo real sobre un mapa (SIG). Proyecto de **Salud Digital UDABOL**.

## ✨ Funcionalidades

- **Acceso con Google** mediante Supabase Auth y creación de perfil por rol.
- **Dos paneles independientes** con control de acceso por rol:
  - **Paciente:** reporta una emergencia con tipo, gravedad, foto opcional y ubicación; ve los centros de salud cercanos, rutas y el estado de sus reportes.
  - **Hospital:** marca la ubicación de su centro, ve las emergencias en espera en el mapa y toma los casos que pueda atender; al finalizar los cierra.
- **Toma de casos sin asignación automática:** el hospital decide; al tomar un caso queda bloqueado para los demás y se traza la ruta centro → paciente con ETA.
- **Mapa en vivo** con Leaflet + OpenStreetMap: emergencias, pacientes, centros de salud, ubicación propia y rutas.
- **Actualización en tiempo real** con Supabase Realtime y respaldo por sondeo cada 4 s.
- **Modo simulación** de GPS para probar la aplicación en computadora.
- Interfaz responsive con Tailwind CSS 4.

## 🧱 Tecnologías

| Capa | Tecnología |
| --- | --- |
| Framework | Next.js 16 (App Router, Turbopack) |
| UI | React 19 + Tailwind CSS 4 |
| Autenticación y datos | Supabase (Auth + Postgres + Realtime) |
| Mapas | Leaflet 1.9 + OpenStreetMap |
| Rutas | OSRM público (con respaldo a línea recta) |

## ✅ Requisitos

- **Node.js 22 o superior** (`.nvmrc` incluido).
- Un proyecto de **Supabase**.
- Una cuenta de **Google Cloud** para configurar el inicio de sesión con Google.
- Navegador con geolocalización. En producción la app debe servirse por **HTTPS** (o `localhost`) para que el GPS funcione.

## 🚀 Puesta en marcha

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de variables de entorno
#    Copia .env.example como .env.local y completa los valores.

# 3. Ejecutar en desarrollo
npm run dev
```

Abre <http://localhost:3000>.

### Variables de entorno

Crea `.env.local` a partir de `.env.example`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=tu-clave-publica
NEXT_PUBLIC_ADMIN_CODE=CAMBIA_ESTE_CODIGO
```

> Usa únicamente la clave **publishable/anon**. La clave `service_role` o `sb_secret_...` nunca debe llegar al navegador.
> También se aceptan los nombres históricos `NEXT_PUBLIC_SUPABASE_ANON_KEY` y `NEXT_PUBLIC_SUPABASE_KEY`.

## 🗄️ Configurar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. Abre **SQL Editor → New query**, pega el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
   Esto crea las tablas `usuarios` y `casos`, índices, triggers, políticas RLS y habilita Realtime.
3. Configura **Authentication → Providers → Google**:
   - Crea credenciales OAuth en Google Cloud Console.
   - URI de redirección autorizada: `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Copia Client ID y Client Secret en Supabase.
4. En **Authentication → URL Configuration**:
   - **Site URL:** `http://localhost:3000` (y tu dominio en producción).
   - **Redirect URLs:** agrega `http://localhost:3000` y `https://tu-dominio.com`.
5. Verifica que Realtime esté habilitado para `usuarios` y `casos` (el script lo agrega a la publicación `supabase_realtime`).

## 👥 Roles y flujo de uso

1. En la pantalla de inicio elige **Registrarse** y tu rol (paciente o hospital).
2. Un **hospital** se registra eligiendo su centro de la lista de Oruro (o escribiendo el nombre).
3. Al entrar con Google se crea el perfil en `usuarios`.
4. El **paciente** reporta una emergencia con tipo, gravedad, foto (opcional) y ubicación.
5. El **hospital** marca la ubicación de su centro, ve las emergencias en espera en el mapa y toma las que pueda atender.
6. Al tomar un caso queda **"🚑 Tomado"** para los demás hospitales y se traza la ruta del centro al paciente con tiempo estimado.
7. Cuando termina, el hospital marca **Finalizar atención**.

> El hospital debe marcar su ubicación en el mapa al menos una vez para poder tomar casos.

## 🧪 Scripts

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Compilación de producción |
| `npm start` | Servir la compilación |
| `npm run lint` | Análisis estático con ESLint |
| `npm run lint:fix` | Corrige automáticamente lo posible |
| `npm run check` | Lint + build (recomendado antes de entregar) |

## 📁 Estructura

```text
salud-digital-udabol/
├─ src/
│  ├─ app/
│  │  ├─ page.js              # Login / registro con Google
│  │  ├─ paciente/page.js     # Panel del paciente
│  │  ├─ hospital/page.js     # Panel del hospital
│  │  ├─ layout.js            # Metadatos y estilos globales
│  │  ├─ error.js             # Frontera de errores
│  │  └─ not-found.js         # Página 404
│  ├─ components/
│  │  ├─ Shell.js             # Cabecera y cierre de sesión
│  │  └─ hooks.js             # Hooks de mapa, GPS, roles y tiempo real
│  └─ lib/
│     ├─ supabase.js          # Cliente de Supabase
│     └─ geo.js               # Distancias, rutas y asignación
├─ supabase/schema.sql        # Esquema completo de base de datos
├─ .env.example
└─ next.config.mjs
```

## 🗃️ Modelo de datos

- **`usuarios`**: perfil 1:1 con `auth.users` (`nombre`, `email`, `rol`, `lat`, `lng`).
- **`casos`**: reporte de emergencia (`tipo`, `cuadro`, `urg`, `estado`, `foto_url`, hospital que lo tomó, `km`, `eta`, `ruta`, coordenadas).
- Estados del caso: `pendiente → asignado → finalizado` (en la interfaz: *En espera → Tomado → Finalizado*).
- Gravedad: `1 = alta (requiere ambulancia)`, `2 = media`, `3 = baja`.

## 🔐 Seguridad

- El repositorio incluye `.env.example`; **nunca** subas `.env.local` ni claves privadas.
- Las políticas RLS incluidas son de **modo demo** (el hospital toma el caso desde el navegador). Para producción se recomienda mover el "tomar caso" a una función RPC `SECURITY DEFINER`, restringir las políticas por rol y no exponer el correo de todos los perfiles.
- Si un secreto llegó a un repositorio, **revócalo de inmediato** y limpia el historial de Git.

## ☁️ Despliegue en Vercel

1. Importa el repositorio en Vercel.
2. Configura las tres variables de entorno del apartado anterior.
3. Build command: `npm run build`. Output: automático para Next.js.
4. Agrega el dominio de producción en Supabase → **Authentication → URL Configuration**.

## 🧭 Solución de problemas

| Problema | Solución |
| --- | --- |
| “Aún no se obtiene tu ubicación” | Permite la ubicación en el navegador. En Windows activa **Configuración → Privacidad y seguridad → Ubicación** y el acceso para el navegador. Usa HTTPS o `localhost`. |
| La ruta se dibuja en línea recta | El servicio público de OSRM no respondió (límite de uso o sin conexión). La app cae a línea recta y sigue funcionando. |
| No se actualizan los casos en vivo | Realtime no está habilitado para las tablas. Ejecuta la parte final de `schema.sql`; mientras tanto, el sondeo cada 4 s mantiene la vista al día. |
| Error de OAuth / vuelve sin sesión | Revisa la **Site URL** y las **Redirect URLs** en Supabase y la URI de Google Cloud. |
| `ERR_NAME_NOT_RESOLVED` o aviso “No se pudo conectar con Supabase” | El proyecto de Supabase no existe, está pausado o la URL tiene un error. Entra a tu panel de Supabase, copia de nuevo la URL y reinicia `npm run dev`. |
| `Unsupported engine` al instalar | Usa Node 22 o superior (`nvm use`). |
| El mapa no aparece | Debe existir un elemento con `id="map"`; las páginas lo renderizan. Revisa la consola si falla la carga de Leaflet. |

## 📌 Notas

- El servicio de tiles de OpenStreetMap y el router público de OSRM son de demostración y tienen límites de uso. Para producción, contrata un proveedor de mapas/rutas.
- Proyecto académico de **Salud Digital UDABOL**.
