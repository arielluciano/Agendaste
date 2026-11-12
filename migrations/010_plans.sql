-- ==============================================================
-- 010_plans.sql
-- Planes por cantidad de turnos (profesionales ilimitados)
-- ==============================================================
-- Reemplaza el cobro por profesional (PRICE_PER_BARBER en routes/subscriptions.js, ya no se usa).
--   plans                       → catálogo de planes (precio, límite mensual de turnos y funciones)
--   businesses.plan_id          → plan contratado (NULL = en prueba / cortesía / nunca se suscribió)
--   businesses.founder_until    → precio fundador (50%) mientras esté vigente. NULL = no es fundador.
--                                 Se asigna a mano, ej.:
--                                 UPDATE businesses SET founder_until = now() + interval '12 months' WHERE id = ...;
--   subscriptions.plan_id       → plan de cada suscripción de Mercado Pago (pasa a businesses.plan_id al autorizarse)
--   plan_usage_notices          → avisos ya mandados (uno por negocio + período + tipo):
--                                 usage_80 / usage_100 (período 'AAAA-MM'), founder_ending (período = fecha de fin),
--                                 founder_price_update (período = día del intento, para reintentar una vez por día)
-- Los planes quedan con RLS sin policies, igual que el resto (ver 003): solo los lee el backend.
-- Correr ANTES de deployar el código que la usa.

CREATE TABLE IF NOT EXISTS public.plans (
  id                        serial PRIMARY KEY,
  code                      text NOT NULL UNIQUE,
  name                      text NOT NULL,
  monthly_price             integer NOT NULL CHECK (monthly_price > 0),
  monthly_appointment_limit integer NOT NULL CHECK (monthly_appointment_limit > 0),
  custom_branding           boolean NOT NULL DEFAULT false,
  embed                     boolean NOT NULL DEFAULT false,
  whatsapp                  boolean NOT NULL DEFAULT false,
  deposits                  boolean NOT NULL DEFAULT false,
  remove_agendaste_footer   boolean NOT NULL DEFAULT false,
  priority_support          boolean NOT NULL DEFAULT false
);
ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

INSERT INTO public.plans
  (code, name, monthly_price, monthly_appointment_limit, custom_branding, embed, whatsapp, deposits, remove_agendaste_footer, priority_support)
VALUES
  ('inicial', 'Inicial', 14900,  80, false, false, false, false, false, false),
  ('pro',     'Pro',     24900, 250, true,  true,  false, false, false, false),
  ('plus',    'Plus',    39900, 600, true,  true,  false, false, true,  true)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  monthly_price = EXCLUDED.monthly_price,
  monthly_appointment_limit = EXCLUDED.monthly_appointment_limit,
  custom_branding = EXCLUDED.custom_branding,
  embed = EXCLUDED.embed,
  whatsapp = EXCLUDED.whatsapp,
  deposits = EXCLUDED.deposits,
  remove_agendaste_footer = EXCLUDED.remove_agendaste_footer,
  priority_support = EXCLUDED.priority_support;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS plan_id integer REFERENCES public.plans(id),
  ADD COLUMN IF NOT EXISTS founder_until timestamptz;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS plan_id integer REFERENCES public.plans(id);

CREATE TABLE IF NOT EXISTS public.plan_usage_notices (
  business_id integer NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  period      text NOT NULL,
  kind        text NOT NULL,
  sent_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, period, kind)
);
ALTER TABLE public.plan_usage_notices ENABLE ROW LEVEL SECURITY;
