-- ============================================================
--  SaludMóvil Bolivia · Esquema de base de datos para Supabase
--  Ejecutar completo en: Supabase → SQL Editor → New query
-- ============================================================
--
--  IMPORTANTE (modo demo/entrega):
--  Las políticas RLS de este archivo son deliberadamente permisivas
--  para que el flujo actual (el paciente asigna al médico desde el
--  navegador) funcione sin backend propio. Antes de usar la app con
--  datos reales, mueve la asignación a una función RPC con
--  SECURITY DEFINER y restringe las políticas por rol.
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
--  Perfiles de usuario (1:1 con auth.users)
-- ------------------------------------------------------------
create table if not exists public.usuarios (
  id          uuid primary key references auth.users (id) on delete cascade,
  nombre      text not null,
  email       text not null default '',
  rol         text not null default 'paciente'
              check (rol in ('paciente', 'hospital')),
  esp         text,
  libre       boolean not null default false,
  lat         double precision check (lat is null or lat between -90 and 90),
  lng         double precision check (lng is null or lng between -180 and 180),
  creado      timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  constraint nombre_valido check (char_length(btrim(nombre)) between 2 and 80),
  constraint coordenadas_completas check ((lat is null) = (lng is null))
);

comment on table public.usuarios is
  'Perfiles de la aplicación. Se crean al terminar el registro con Google.';

-- ------------------------------------------------------------
--  Reportes de emergencia
-- ------------------------------------------------------------
create table if not exists public.casos (
  id             uuid primary key default gen_random_uuid(),
  paciente_id    uuid not null references public.usuarios (id) on delete cascade,
  nombre         text not null,
  cuadro         text not null,
  esp            text not null default 'Cualquiera',
  urg            smallint not null default 2 check (urg between 1 and 3),
  estado         text not null default 'pendiente'
                 check (estado in ('pendiente', 'asignado', 'finalizado')),
  tipo           text not null default 'otro',
  foto_url       text,
  hospital_id    uuid references public.usuarios (id) on delete set null,
  hospital_nombre text,
  km             double precision,
  eta            integer,
  ruta           text,
  tipo_ruta      text,
  lat            double precision not null check (lat between -90 and 90),
  lng            double precision not null check (lng between -180 and 180),
  creado         timestamptz not null default now(),
  actualizado    timestamptz not null default now(),
  constraint cuadro_valido check (char_length(btrim(cuadro)) between 3 and 500)
);

comment on table public.casos is
  'Reportes de emergencia con foto opcional, tipo, gravedad y asignación de médico.';

-- ------------------------------------------------------------
--  Compatibilidad con instalaciones anteriores
--  (si ya existen las columnas, estas sentencias no hacen nada)
-- ------------------------------------------------------------
-- ------------------------------------------------------------
--  Migración desde instalaciones anteriores (panel de médico/admin)
--  Si ya ejecutaste el esquema viejo, esto convierte la base sin
--  perder datos. En una instalación nueva no hace nada.
-- ------------------------------------------------------------
alter table public.usuarios drop constraint if exists usuarios_rol_check;
alter table public.usuarios drop constraint if exists usuarios_especialidad_medico;
update public.usuarios set rol = 'hospital' where rol = 'medico';
alter table public.usuarios add constraint usuarios_rol_check
  check (rol in ('paciente', 'hospital'));

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casos'
      and column_name = 'medico_id'
  ) then
    alter table public.casos rename column medico_id to hospital_id;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'casos'
      and column_name = 'medico_nombre'
  ) then
    alter table public.casos rename column medico_nombre to hospital_nombre;
  end if;
end
$$;

alter table public.usuarios add column if not exists creado timestamptz not null default now();
alter table public.usuarios add column if not exists actualizado timestamptz not null default now();
alter table public.usuarios add column if not exists esp text;
alter table public.usuarios add column if not exists libre boolean not null default false;
alter table public.usuarios add column if not exists lat double precision;
alter table public.usuarios add column if not exists lng double precision;

alter table public.casos add column if not exists creado timestamptz not null default now();
alter table public.casos add column if not exists actualizado timestamptz not null default now();
alter table public.casos add column if not exists medico_nombre text;
alter table public.casos add column if not exists km double precision;
alter table public.casos add column if not exists eta integer;
alter table public.casos add column if not exists ruta text;
alter table public.casos add column if not exists tipo_ruta text;
alter table public.casos add column if not exists tipo text not null default 'otro';
alter table public.casos add column if not exists foto_url text;

-- ------------------------------------------------------------
--  Bucket de fotos de emergencias (Supabase Storage)
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('evidencias', 'evidencias', true)
on conflict (id) do nothing;

drop policy if exists "evidencias_subir_autenticada" on storage.objects;
create policy "evidencias_subir_autenticada"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'evidencias');

drop policy if exists "evidencias_leer_autenticada" on storage.objects;
create policy "evidencias_leer_autenticada"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'evidencias');

-- ------------------------------------------------------------
--  Índices
-- ------------------------------------------------------------
create index if not exists idx_usuarios_rol_libre
  on public.usuarios (rol, libre);

create index if not exists idx_usuarios_ubicacion
  on public.usuarios (lat, lng);

create index if not exists idx_casos_estado_urgencia
  on public.casos (estado, urg, creado);

create index if not exists idx_casos_paciente
  on public.casos (paciente_id, creado desc);

create index if not exists idx_casos_hospital
  on public.casos (hospital_id, estado);

-- ------------------------------------------------------------
--  Trigger de actualización
-- ------------------------------------------------------------
create or replace function public.tocar_actualizado()
returns trigger
language plpgsql
as $$
begin
  new.actualizado = now();
  return new;
end;
$$;

drop trigger if exists trg_usuarios_actualizado on public.usuarios;
create trigger trg_usuarios_actualizado
  before update on public.usuarios
  for each row execute function public.tocar_actualizado();

drop trigger if exists trg_casos_actualizado on public.casos;
create trigger trg_casos_actualizado
  before update on public.casos
  for each row execute function public.tocar_actualizado();

-- ------------------------------------------------------------
--  Row Level Security (modo demo)
-- ------------------------------------------------------------
alter table public.usuarios enable row level security;
alter table public.casos enable row level security;

drop policy if exists "usuarios_lectura_autenticada" on public.usuarios;
create policy "usuarios_lectura_autenticada"
  on public.usuarios for select
  to authenticated
  using (true);

drop policy if exists "usuarios_alta_propia" on public.usuarios;
create policy "usuarios_alta_propia"
  on public.usuarios for insert
  to authenticated
  with check (id = auth.uid());

drop policy if exists "usuarios_actualizacion_autenticada" on public.usuarios;
create policy "usuarios_actualizacion_autenticada"
  on public.usuarios for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "casos_lectura_autenticada" on public.casos;
create policy "casos_lectura_autenticada"
  on public.casos for select
  to authenticated
  using (true);

drop policy if exists "casos_alta_paciente" on public.casos;
create policy "casos_alta_paciente"
  on public.casos for insert
  to authenticated
  with check (paciente_id = auth.uid());

drop policy if exists "casos_actualizacion_autenticada" on public.casos;
create policy "casos_actualizacion_autenticada"
  on public.casos for update
  to authenticated
  using (true)
  with check (true);

-- Permisos para el rol autenticado de Supabase.
grant usage on schema public to authenticated;
grant select, insert, update on public.usuarios to authenticated;
grant select, insert, update on public.casos to authenticated;
revoke all on public.usuarios from anon;
revoke all on public.casos from anon;

-- ------------------------------------------------------------
--  Realtime (actualización en vivo de ambas tablas)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'usuarios'
    ) then
      execute 'alter publication supabase_realtime add table public.usuarios';
    end if;

    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public' and tablename = 'casos'
    ) then
      execute 'alter publication supabase_realtime add table public.casos';
    end if;
  end if;
end
$$;
