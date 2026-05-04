-- Cron job: sincronizar GPS do SALVADORSAT a cada 1 minuto
-- Rodar no SQL Editor do Supabase Dashboard

select cron.schedule(
  'sync-itrack-gps',
  '* * * * *',
  $$
  select
    net.http_post(
      url     := 'https://oomxnhgyxaimkvdllmao.supabase.co/functions/v1/sync-itrack-gps',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9vbXhuaGd5eGFpbWt2ZGxsbWFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5Nzc4NzQsImV4cCI6MjA4MTU1Mzg3NH0.GdnvJGnmLnkT7zIZ9cGBEM18nOsSlHeedCI89r7k6ak"}'::jsonb,
      body    := '{}'::jsonb
    ) as request_id;
  $$
);

-- Para verificar se o job foi criado:
-- select * from cron.job;

-- Para remover o job se precisar:
-- select cron.unschedule('sync-itrack-gps');
