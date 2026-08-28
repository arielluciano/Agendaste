-- ==============================================================
-- 003_enable_rls_20260826.sql
-- Habilita Row Level Security en todas las tablas de public
-- ==============================================================
--
-- CONTEXTO (confirmado 2026-08-26):
--   - Las 7 tablas del schema public tenían rowsecurity = false.
--   - La API REST de Supabase (PostgREST) está expuesta públicamente
--     y es alcanzable con la SUPABASE_KEY publicable sin pasar por
--     ninguna autenticación de la app (se confirmó lectura directa
--     de la tabla owners por ese camino).
--
-- QUÉ HACE ESTA MIGRACIÓN:
--   Activa RLS en las 7 tablas, SIN crear ninguna policy.
--   RLS habilitado + cero policies = deny-all por defecto para
--   cualquier rol sujeto a RLS (anon, authenticated) vía PostgREST.
--
-- POR QUÉ NO SE ROMPE EL BACKEND:
--   El backend Express (config/database.js, routes/*.js) se conecta
--   vía DATABASE_URL con el rol "postgres", que tiene
--   rolbypassrls = true. RLS nunca se evalúa para ese rol, sea cual
--   sea su configuración. El backend sigue funcionando exactamente
--   igual que antes de esta migración.
--
-- QUÉ CAMBIA EN LA PRÁCTICA:
--   Cualquier acceso a estas tablas a través de PostgREST
--   (SUPABASE_URL + SUPABASE_KEY, ej. desde el frontend o desde
--   afuera) deja de devolver filas, porque no hay policies que
--   autoricen a anon/authenticated. El único camino de acceso a
--   los datos vuelve a ser el backend propio.
-- ==============================================================

ALTER TABLE public.appointments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barber_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.barbers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.services          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions     ENABLE ROW LEVEL SECURITY;

-- Verificación post-aplicación (opcional, correr después para confirmar):
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
-- Las 7 filas deberían mostrar rowsecurity = true.
