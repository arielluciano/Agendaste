-- ==============================================================
-- 005_appointments_reminder_sent_at.sql
-- Recordatorio por mail de turnos (POST /api/cron/reminders)
-- ==============================================================
-- NULL = todavía no se mandó el recordatorio.
-- Se completa al reclamar el turno para mandarle el mail (antes del envío),
-- así dos corridas superpuestas del cron no lo mandan dos veces.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

-- Índice parcial: el cron solo mira turnos pendientes de recordatorio
CREATE INDEX IF NOT EXISTS appointments_reminder_pending_idx
  ON public.appointments (date)
  WHERE reminder_sent_at IS NULL AND client_email IS NOT NULL;
