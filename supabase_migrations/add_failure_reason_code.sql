-- Código canônico do motivo da devolução, escolhido pelo motorista numa lista
-- fixa. failure_reason segue existindo como detalhe livre/opcional e guarda o
-- histórico dos registros antigos, quando o motivo era 100% texto solto.
ALTER TABLE public.delivery_proofs
  ADD COLUMN IF NOT EXISTS failure_reason_code TEXT;

COMMENT ON COLUMN public.delivery_proofs.failure_reason_code IS
  'Motivo padronizado da devolução/pendência (ex: CLIENTE_RECUSOU). NULL nos registros anteriores à padronização.';

CREATE INDEX IF NOT EXISTS idx_delivery_proofs_failure_reason_code
  ON public.delivery_proofs (failure_reason_code)
  WHERE failure_reason_code IS NOT NULL;
