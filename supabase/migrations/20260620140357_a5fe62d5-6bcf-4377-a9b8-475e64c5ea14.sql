ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS cron_interval_minutes integer NOT NULL DEFAULT 5
    CHECK (cron_interval_minutes BETWEEN 1 AND 60);

CREATE OR REPLACE FUNCTION public.update_poll_cron_interval(_minutes integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _minutes < 1 OR _minutes > 60 THEN
    RAISE EXCEPTION 'cron_interval_minutes must be between 1 and 60';
  END IF;

  PERFORM cron.unschedule('meeting-agent-poll-gmail')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'meeting-agent-poll-gmail');

  PERFORM cron.schedule(
    'meeting-agent-poll-gmail',
    '*/' || _minutes::text || ' * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://project--b9920c2c-3fd4-4f38-896d-993da149405a.lovable.app/api/public/hooks/poll-gmail',
      headers := '{"Content-Type": "application/json", "apikey": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlya3hldWx6emxwcHNzc3ZnaGF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExODYwNjIsImV4cCI6MjA5Njc2MjA2Mn0.ESDW1fHBHbWmTO95JRMW-cz9oNoYvp39GIRiVaa11wI"}'::jsonb,
      body := '{}'::jsonb
    );
    $job$
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_poll_cron_interval(integer) FROM public;
GRANT EXECUTE ON FUNCTION public.update_poll_cron_interval(integer) TO authenticated;