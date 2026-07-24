-- Marca quando o motorista iniciou a rota atual. NULL = sem rota ativa.
-- Fonte de verdade do "rota ativa", no lugar do localStorage do celular
-- (que morria ao trocar de aparelho ou virar o dia).
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS route_started_at timestamptz;

COMMENT ON COLUMN public.drivers.route_started_at IS
  'Início da rota ativa do motorista. NULL = não está em rota. Setado no Iniciar Rota, zerado no Finalizar Rota.';
