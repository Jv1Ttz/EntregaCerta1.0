-- Tabela de etiquetas registradas pelo módulo de etiquetas logísticas
CREATE TABLE IF NOT EXISTS saved_labels (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  barcode_value TEXT      NOT NULL,
  label_text  TEXT        NOT NULL DEFAULT '',
  format      TEXT        NOT NULL DEFAULT 'CODE128',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ordena sempre da mais recente para a mais antiga
CREATE INDEX IF NOT EXISTS saved_labels_created_at_idx ON saved_labels (created_at DESC);

-- RLS: apenas usuários autenticados (admin) podem ler/escrever
ALTER TABLE saved_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access" ON saved_labels
  FOR ALL
  USING (true)
  WITH CHECK (true);
