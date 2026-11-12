-- ==============================================================
-- 009_business_link_shared_at.sql
-- Checklist de configuración del inicio del panel
-- ==============================================================
-- link_shared_at: cuándo el dueño copió o compartió por primera vez su link
--   de reservas (POST /api/business/link-shared). NULL = todavía no.
-- onboarding_dismissed_at: cuándo ocultó el checklist completo con "Ocultar"
--   (POST /api/business/onboarding-dismissed). Con fecha, no se muestra más.
-- Se guardan en la base para que valgan en todos los dispositivos.
-- Correr ANTES de deployar el código que usa estas columnas.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS link_shared_at timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_dismissed_at timestamptz;
