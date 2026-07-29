-- Trava de corrida no nível do banco: um motorista só pode ter UMA rota ativa
-- e UMA agendada por vez. Cliques simultâneos (o guard do app é checa-depois-
-- grava) passam a falhar no INSERT do perdedor em vez de duplicar rotas.
-- Vale para qualquer cliente, inclusive APKs antigos.
CREATE UNIQUE INDEX IF NOT EXISTS routes_one_in_progress_per_driver
  ON public.routes (driver_id) WHERE status = 'IN_PROGRESS';
CREATE UNIQUE INDEX IF NOT EXISTS routes_one_scheduled_per_driver
  ON public.routes (driver_id) WHERE status = 'SCHEDULED';
