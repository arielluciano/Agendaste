-- ==============================================================
-- 008_appointments_attendance.sql
-- Asistencia del cliente al turno (la marca el dueño desde el panel)
-- ==============================================================
-- NULL = sin marcar · 'attended' = asistió · 'no_show' = no vino.
-- Lo escribe PATCH /api/appointments/:id/attendance (solo turnos de hoy
-- o anteriores que no estén cancelados).
-- Correr ANTES de deployar el código que usa esta columna.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS attendance text
  CHECK (attendance IN ('attended', 'no_show'));
