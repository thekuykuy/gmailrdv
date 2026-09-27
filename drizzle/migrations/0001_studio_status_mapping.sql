CREATE OR REPLACE FUNCTION public.studio_forward_event()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  rec jsonb := to_jsonb(NEW);
  old_rec jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END;
  conn public.studio_connections%ROWTYPE;
  label text; raw_status text; status text;
BEGIN
  IF TG_OP = 'UPDATE' AND (rec->>'status') IS NOT DISTINCT FROM (old_rec->>'status') THEN RETURN NEW; END IF;
  SELECT * INTO conn FROM public.studio_connections WHERE user_id = (rec->>'user_id')::uuid AND enabled;
  IF NOT FOUND THEN RETURN NEW; END IF;
  label := coalesce(rec->>'action', rec->>'operation', rec->>'type', rec->>'event_type', rec->>'intent', TG_TABLE_NAME);
  raw_status := lower(coalesce(rec->>'status', rec->>'level', ''));
  status := CASE
    WHEN raw_status IN ('error','failed','failure') OR (rec ? 'success' AND (rec->>'success') = 'false') THEN 'error'
    WHEN raw_status IN ('warning','warn','cancelled','canceled') THEN 'warning'
    WHEN raw_status IN ('pending','running','processing','open','awaiting') THEN 'running'
    ELSE 'success' END;
  BEGIN
    PERFORM net.http_post(
      url := conn.endpoint_url,
      headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || conn.api_key,'x-api-key',conn.api_key),
      body := jsonb_build_object(
        'task', TG_TABLE_NAME || ' · ' || label || ' · ' || coalesce(nullif(raw_status,''), lower(TG_OP)),
        'source', TG_TABLE_NAME, 'operation', TG_OP, 'status', status, 'raw_status', nullif(raw_status,''),
        'occurred_at', now(), 'event', rec, 'previous', old_rec),
      timeout_milliseconds := 5000);
    UPDATE public.studio_connections SET sent_count = sent_count + 1, last_sent_at = now() WHERE id = conn.id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN RETURN NEW;
END $function$;