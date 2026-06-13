SELECT cron.unschedule('meeting-agent-poll-gmail')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-agent-poll-gmail');

SELECT cron.schedule(
  'meeting-agent-poll-gmail',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--b9920c2c-3fd4-4f38-896d-993da149405a.lovable.app/api/public/hooks/poll-gmail',
    headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlya3hldWx6emxwcHNzc3ZnaGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODYwNjIsImV4cCI6MjA5Njc2MjA2Mn0.ESDW1fHBHbWmTO95JRMW-cz9oNoYvp39GIRiVaa11wI"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);