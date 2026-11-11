-- ==============================================================
-- 004_business_brand.sql
-- Marca por negocio para la página pública de reservas
-- ==============================================================
-- Todas nullable: NULL = se usa el diseño por defecto de Agendaste.
-- La validación (hex, lista blanca de fuentes, https) se hace en el
-- backend (routes/business.js → PATCH /api/business/brand).

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS brand_primary text,
  ADD COLUMN IF NOT EXISTS brand_bg      text,
  ADD COLUMN IF NOT EXISTS brand_text    text,
  ADD COLUMN IF NOT EXISTS brand_font    text,
  ADD COLUMN IF NOT EXISTS logo_url      text;
