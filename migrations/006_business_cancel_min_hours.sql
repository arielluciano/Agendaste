-- ==============================================================
-- 006_business_cancel_min_hours.sql
-- Anticipación mínima para que el cliente cancele o reprograme
-- ==============================================================
-- Horas antes del turno hasta las que el cliente puede cancelar o
-- reprogramar desde "Mis turnos". 0 = sin límite.
-- Lo validan PATCH /api/appointments/:id/cancel-mine y /:id/reschedule.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS cancel_min_hours integer NOT NULL DEFAULT 2
  CHECK (cancel_min_hours >= 0);
