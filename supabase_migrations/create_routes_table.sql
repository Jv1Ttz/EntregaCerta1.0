-- Entidade "rota": uma linha por jornada de entrega de um motorista.
-- Serve tanto ao histórico (Controladoria de Rotas) quanto ao agendamento
-- futuro — uma rota agendada é só uma rota que ainda não foi iniciada.
CREATE TABLE IF NOT EXISTS public.routes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id     text NOT NULL REFERENCES public.drivers(id),
  vehicle_id    text REFERENCES public.vehicles(id),

  -- Ciclo de vida. SCHEDULED/CANCELLED ficam prontos pro agendamento futuro.
  status        text NOT NULL DEFAULT 'IN_PROGRESS'
                  CHECK (status IN ('SCHEDULED','IN_PROGRESS','FINISHED','CANCELLED')),
  scheduled_for date,           -- dia planejado (só no agendamento)

  started_at    timestamptz,    -- NULL enquanto só agendada
  finished_at   timestamptz,
  finished_by   text CHECK (finished_by IN ('DRIVER','GESTOR')),

  -- Snapshot do resultado, gravado na finalização (imutável).
  delivered_count     int NOT NULL DEFAULT 0,  -- entregues
  returned_count      int NOT NULL DEFAULT 0,  -- devolvidas (FAILED)
  issue_count         int NOT NULL DEFAULT 0,  -- pendências (ISSUE)
  not_delivered_count int NOT NULL DEFAULT 0,  -- "não entregue hoje" (valve)
  leftover_count      int NOT NULL DEFAULT 0,  -- sobras devolvidas à fila no fim

  created_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.routes IS 'Jornadas de entrega (rotas). status=SCHEDULED reservado p/ agendamento futuro.';

CREATE INDEX IF NOT EXISTS routes_driver_started_idx
  ON public.routes (driver_id, started_at DESC);
CREATE INDEX IF NOT EXISTS routes_status_idx
  ON public.routes (status);

-- Liga a nota à rota em que foi tratada, para o drill-down da controladoria.
-- Nullable e sem default: código antigo ignora, notas antigas ficam NULL.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.routes(id);
CREATE INDEX IF NOT EXISTS invoices_route_id_idx
  ON public.invoices (route_id);

-- RLS desligado, igual invoices/notifications: a app escreve com a anon key.
ALTER TABLE public.routes DISABLE ROW LEVEL SECURITY;
