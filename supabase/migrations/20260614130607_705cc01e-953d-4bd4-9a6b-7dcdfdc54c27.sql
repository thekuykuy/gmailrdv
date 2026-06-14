ALTER TABLE public.agent_settings
  ADD COLUMN IF NOT EXISTS ai_model TEXT NOT NULL DEFAULT 'google/gemini-2.5-flash';

ALTER TABLE public.agent_settings
  DROP CONSTRAINT IF EXISTS agent_settings_ai_model_allowed;

ALTER TABLE public.agent_settings
  ADD CONSTRAINT agent_settings_ai_model_allowed
  CHECK (ai_model IN (
    'google/gemini-3-flash-preview',
    'google/gemini-3.1-flash-lite-preview',
    'google/gemini-3.5-flash',
    'google/gemini-3.1-pro-preview',
    'google/gemini-2.5-pro',
    'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-lite',
    'openai/gpt-5',
    'openai/gpt-5-mini',
    'openai/gpt-5-nano',
    'openai/gpt-5.2',
    'openai/gpt-5.4',
    'openai/gpt-5.4-mini',
    'openai/gpt-5.4-nano',
    'openai/gpt-5.4-pro',
    'openai/gpt-5.5',
    'openai/gpt-5.5-pro'
  ));

ALTER TABLE public.google_connections
  ADD COLUMN IF NOT EXISTS processing_lock_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS google_connections_processing_lock_idx
  ON public.google_connections(user_id, processing_lock_until);

CREATE OR REPLACE FUNCTION public.claim_google_processing_lock(_user_id uuid, _ttl_seconds integer DEFAULT 300)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_count integer;
BEGIN
  UPDATE public.google_connections
  SET processing_lock_until = now() + make_interval(secs => greatest(_ttl_seconds, 30)),
      updated_at = now()
  WHERE user_id = _user_id
    AND (processing_lock_until IS NULL OR processing_lock_until < now());

  GET DIAGNOSTICS claimed_count = ROW_COUNT;
  RETURN claimed_count = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_google_processing_lock(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.google_connections
  SET processing_lock_until = NULL,
      updated_at = now()
  WHERE user_id = _user_id;
END;
$$;