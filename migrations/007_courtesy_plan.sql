-- ==============================================================
-- 007_courtesy_plan.sql
-- Plan de cortesía: acceso completo sin cobro
-- ==============================================================
-- El estado va en el mismo campo de siempre: owners.plan = 'courtesy'
-- (varchar sin CHECK, no hace falta tocar nada ahí).
-- Vencimiento opcional por negocio: NULL = cortesía sin vencimiento.
-- Cortesía vigente = plan 'courtesy' AND (courtesy_until IS NULL OR courtesy_until > now()).
-- Lo usan middleware/auth.js, GET /api/subscriptions/status y services/seo.js (sitemap / noindex).
-- Correr ANTES de deployar el código que la lee.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS courtesy_until timestamptz;
