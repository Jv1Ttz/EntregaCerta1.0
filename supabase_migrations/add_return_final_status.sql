-- ============================================================
-- Finalização do fluxo de devolução (EntregaCerta)
-- Execute no SQL Editor do Supabase (Dashboard > SQL Editor)
-- ============================================================

-- 1. Coluna que indica se a devolução foi encerrada e como:
--    NULL = devolução ainda "aberta" (pode reenviar para reentrega)
--    'CONCLUDED' = devolução concluída (mercadoria recebida de volta, processo encerrado)
--    'CANCELLED' = cancelada (cliente desistiu / não quer mais)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS return_final_status text
  CHECK (return_final_status IS NULL OR return_final_status IN ('CONCLUDED', 'CANCELLED'));

-- 2. Data/hora em que a devolução foi finalizada (histórico)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS return_finalized_at timestamptz;

-- Comentários nas colunas (opcional, ajuda na documentação)
COMMENT ON COLUMN invoices.return_final_status IS 'NULL=aberta, CONCLUDED=concluída, CANCELLED=cancelada';
COMMENT ON COLUMN invoices.return_finalized_at IS 'Quando a devolução foi finalizada (concluída ou cancelada)';
-- 3. Observação administrativa do encerramento (opcional)
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS return_final_note text;
COMMENT ON COLUMN invoices.return_final_note IS 'Observação livre registrada pelo gestor ao encerrar a devolução';
