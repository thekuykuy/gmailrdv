CREATE TABLE public.studio_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint_url text NOT NULL CHECK (endpoint_url ~* '^https://'),
  api_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sent_count bigint NOT NULL DEFAULT 0,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT, UPDATE, DELETE ON public.studio_connections TO authenticated;
GRANT SELECT (id, user_id, endpoint_url, enabled, sent_count, last_sent_at, created_at, updated_at) ON public.studio_connections TO authenticated;
GRANT ALL ON public.studio_connections TO service_role;
ALTER TABLE public.studio_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own studio select" ON public.studio_connections FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own studio insert" ON public.studio_connections FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own studio update" ON public.studio_connections FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own studio delete" ON public.studio_connections FOR DELETE TO authenticated USING (auth.uid() = user_id);
ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_connections;

CREATE OR REPLACE FUNCTION public.studio_forward_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  rec jsonb := to_jsonb(NEW);
  old_rec jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  conn public.studio_connections%ROWTYPE;
  label text;
  status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (rec->>'status') IS NOT DISTINCT FROM (old_rec->>'status') THEN
    RETURN NEW;
  END IF;
  SELECT * INTO conn FROM public.studio_connections WHERE user_id = (rec->>'user_id')::uuid AND enabled;
  IF NOT FOUND THEN RETURN NEW; END IF;
  label := coalesce(rec->>'action', rec->>'operation', rec->>'type', rec->>'event_type', rec->>'intent', TG_TABLE_NAME);
  status := coalesce(rec->>'status', CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END);
  BEGIN
    PERFORM net.http_post(
      url := conn.endpoint_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || conn.api_key,'x-api-key',conn.api_key),
      body := jsonb_build_object(
        'task', TG_TABLE_NAME || ' · ' || label || ' · ' || status,
        'source', TG_TABLE_NAME, 'operation', TG_OP, 'status', status,
        'occurred_at', now(), 'event', rec, 'previous', old_rec),
      timeout_milliseconds := 5000
    );
    UPDATE public.studio_connections SET sent_count = sent_count + 1, last_sent_at = now() WHERE id = conn.id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public.studio_forward_event() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER studio_fwd AFTER INSERT OR UPDATE ON public.activity_logs FOR EACH ROW EXECUTE FUNCTION public.studio_forward_event();
CREATE TRIGGER studio_fwd AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.studio_forward_event();
CREATE TRIGGER studio_fwd AFTER INSERT OR UPDATE ON public.email_threads FOR EACH ROW EXECUTE FUNCTION public.studio_forward_event();
CREATE TRIGGER studio_fwd AFTER INSERT OR UPDATE ON public.ai_usage_logs FOR EACH ROW EXECUTE FUNCTION public.studio_forward_event();
CREATE TRIGGER studio_fwd AFTER INSERT ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.studio_forward_event();