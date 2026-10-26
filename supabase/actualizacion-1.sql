-- =============================================================
-- actualizacion-1.sql — Horarios a medida y vacaciones
-- -------------------------------------------------------------
-- Añade a la tabla "turnos":
--   · el código V (vacaciones)
--   · el código H (horario a medida) con hora de entrada y salida
-- Cómo usarlo: Supabase → SQL Editor → New query → pega todo → Run.
-- No borra nada y se puede ejecutar varias veces.
-- =============================================================

alter table public.turnos add column if not exists hora_inicio time;
alter table public.turnos add column if not exists hora_fin    time;

-- Códigos permitidos (se rehace la comprobación con V y H)
alter table public.turnos drop constraint if exists turnos_codigo_check;
alter table public.turnos add constraint turnos_codigo_check
  check (codigo in ('M', 'T', 'N', 'FM', 'FT', 'FN', 'L', 'V', 'H'));

-- Un horario a medida (H) tiene que llevar las dos horas
alter table public.turnos drop constraint if exists turnos_horas_check;
alter table public.turnos add constraint turnos_horas_check
  check (codigo <> 'H' or (hora_inicio is not null and hora_fin is not null));

-- Avisar a la API de Supabase de las columnas nuevas
notify pgrst, 'reload schema';
