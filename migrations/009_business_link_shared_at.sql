-- ==============================================================
-- 009_business_link_shared_at.sql
-- Cuándo el dueño compartió por primera vez su link de reservas
-- ==============================================================
-- NULL = todavía no lo copió ni lo compartió desde el panel.
-- Lo escribe POST /api/business/link-shared (Copiar / Compartir por WhatsApp)
-- y lo usa el checklist del inicio, así vale en todos los dispositivos.
-- Correr ANTES de deployar el código que usa esta columna.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS link_shared_at timestamptz;
