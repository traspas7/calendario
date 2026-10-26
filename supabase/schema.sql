-- =============================================================
-- schema.sql — Base de datos del calendario de Dani y Eva
-- -------------------------------------------------------------
-- Cómo usarlo: Supabase → SQL Editor → New query → pega TODO
-- este archivo → CAMBIA EL PIN del paso 2 → pulsa "Run".
-- Se puede ejecutar varias veces sin romper nada.
-- =============================================================


-- -------------------------------------------------------------
-- 1) Extensión para cifrar el PIN (bcrypt)
-- -------------------------------------------------------------
create extension if not exists pgcrypto with schema extensions;


-- -------------------------------------------------------------
-- 2) Tabla PRIVADA con el PIN cifrado
--    RLS activado y SIN políticas = nadie puede leerla desde la web.
--    Solo la usa la función pin_valido(), que se ejecuta como dueño.
-- -------------------------------------------------------------
create table if not exists public.ajustes_privados (
  id        int  primary key default 1 check (id = 1),  -- solo puede haber una fila
  pin_hash  text not null
);
alter table public.ajustes_privados enable row level security;
revoke all on public.ajustes_privados from anon, authenticated;

-- 👇👇👇 CAMBIA 'CAMBIA-ESTE-PIN' POR VUESTRO PIN (mínimo 8 caracteres, sin tildes ni ñ ni espacios)
insert into public.ajustes_privados (id, pin_hash)
values (1, extensions.crypt('CAMBIA-ESTE-PIN',extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash;


-- -------------------------------------------------------------
-- 3) Función que comprueba el PIN
--    La web manda el PIN en la cabecera HTTP "x-calendario-pin".
--    Supabase deja las cabeceras en request.headers y aquí se
--    compara con el hash guardado.
--    SECURITY DEFINER: se ejecuta con permisos del dueño, por eso
--    puede leer ajustes_privados aunque el visitante no pueda.
-- -------------------------------------------------------------
create or replace function public.pin_valido()
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select coalesce(
    (
      select p.pin_hash = extensions.crypt(
               coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-calendario-pin', ''),
               p.pin_hash)
      from public.ajustes_privados p
      where p.id = 1
    ),
    false
  );
$$;

revoke all on function public.pin_valido() from public;
grant execute on function public.pin_valido() to anon, authenticated;


-- -------------------------------------------------------------
-- 4) Tabla de TURNOS: un turno por persona y día
-- -------------------------------------------------------------
create table if not exists public.turnos (
  persona     text        not null check (persona in ('dani', 'eva')),
  fecha       date        not null,
  codigo      text        not null,  -- M, T, N, FM, FT, FN, L, V o H (horario a medida)
  hora_inicio time,                  -- solo para H
  hora_fin    time,                  -- solo para H
  actualizado timestamptz not null default now(),
  primary key (persona, fecha)   -- evita duplicados y permite "upsert"
);

-- Comprobaciones (incluye lo de actualizacion-1.sql por si la tabla ya existía)
alter table public.turnos add column if not exists hora_inicio time;
alter table public.turnos add column if not exists hora_fin    time;
alter table public.turnos drop constraint if exists turnos_codigo_check;
alter table public.turnos add constraint turnos_codigo_check
  check (codigo in ('M', 'T', 'N', 'FM', 'FT', 'FN', 'L', 'V', 'H'));
alter table public.turnos drop constraint if exists turnos_horas_check;
alter table public.turnos add constraint turnos_horas_check
  check (codigo <> 'H' or (hora_inicio is not null and hora_fin is not null));


-- -------------------------------------------------------------
-- 5) Tabla de EVENTOS personalizados
-- -------------------------------------------------------------
create table if not exists public.eventos (
  id           uuid        primary key default gen_random_uuid(),
  titulo       text        not null check (char_length(titulo) between 1 and 120),
  emoji        text        not null default '📅' check (char_length(emoji) <= 16),
  fecha        date        not null,
  todo_el_dia  boolean     not null default false,
  hora_inicio  time,
  hora_fin     time,
  notas        text        check (char_length(notas) <= 2000),
  quien        text        not null check (quien in ('dani', 'eva', 'ambos')),
  creado       timestamptz not null default now(),
  actualizado  timestamptz not null default now()
);
create index if not exists eventos_fecha_idx on public.eventos (fecha);


-- -------------------------------------------------------------
-- 6) Rellenar "actualizado" automáticamente al modificar
-- -------------------------------------------------------------
create or replace function public.tocar_actualizado()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.actualizado := now();
  return new;
end;
$$;

drop trigger if exists turnos_actualizado on public.turnos;
create trigger turnos_actualizado before update on public.turnos
  for each row execute function public.tocar_actualizado();

drop trigger if exists eventos_actualizado on public.eventos;
create trigger eventos_actualizado before update on public.eventos
  for each row execute function public.tocar_actualizado();


-- -------------------------------------------------------------
-- 7) Seguridad a nivel de fila (RLS)
--    Sin el PIN correcto en la cabecera: no se ve ni se cambia nada.
--    "(select public.pin_valido())" entre paréntesis hace que Postgres
--    compruebe el PIN UNA vez por consulta y no una vez por fila.
-- -------------------------------------------------------------
alter table public.turnos  enable row level security;
alter table public.eventos enable row level security;

grant select, insert, update, delete on public.turnos, public.eventos to anon, authenticated;

-- Borramos políticas anteriores (por si ejecutas el archivo otra vez)
drop policy if exists "turnos: leer con PIN"       on public.turnos;
drop policy if exists "turnos: crear con PIN"      on public.turnos;
drop policy if exists "turnos: cambiar con PIN"    on public.turnos;
drop policy if exists "turnos: borrar con PIN"     on public.turnos;
drop policy if exists "eventos: leer con PIN"      on public.eventos;
drop policy if exists "eventos: crear con PIN"     on public.eventos;
drop policy if exists "eventos: cambiar con PIN"   on public.eventos;
drop policy if exists "eventos: borrar con PIN"    on public.eventos;

create policy "turnos: leer con PIN"     on public.turnos  for select to anon, authenticated using ((select public.pin_valido()));
create policy "turnos: crear con PIN"    on public.turnos  for insert to anon, authenticated with check ((select public.pin_valido()));
create policy "turnos: cambiar con PIN"  on public.turnos  for update to anon, authenticated using ((select public.pin_valido())) with check ((select public.pin_valido()));
create policy "turnos: borrar con PIN"   on public.turnos  for delete to anon, authenticated using ((select public.pin_valido()));

create policy "eventos: leer con PIN"    on public.eventos for select to anon, authenticated using ((select public.pin_valido()));
create policy "eventos: crear con PIN"   on public.eventos for insert to anon, authenticated with check ((select public.pin_valido()));
create policy "eventos: cambiar con PIN" on public.eventos for update to anon, authenticated using ((select public.pin_valido())) with check ((select public.pin_valido()));
create policy "eventos: borrar con PIN"  on public.eventos for delete to anon, authenticated using ((select public.pin_valido()));


-- -------------------------------------------------------------
-- 8) Avisar a la API de Supabase de que hay tablas/funciones nuevas
--    (sin esto a veces la web dice "Falta la función pin_valido")
-- -------------------------------------------------------------
notify pgrst, 'reload schema';


-- =============================================================
-- EXTRA: para CAMBIAR EL PIN más adelante, ejecuta solo esto
-- (y luego en cada móvil: Ajustes ⚙️ → "Olvidar el PIN"):
--
--   update public.ajustes_privados
--   set pin_hash = extensions.crypt('NUEVO-PIN', extensions.gen_salt('bf'))
--   where id = 1;
-- =============================================================
