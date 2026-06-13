CREATE OR REPLACE FUNCTION public.prevent_confirmed_appointment_overlap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_end timestamptz;
BEGIN
  IF NEW.status <> 'confirmed' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.user_id::text, 0));
  new_end := NEW.scheduled_at + (NEW.duration_minutes * interval '1 minute');

  IF EXISTS (
    SELECT 1
    FROM public.appointments existing
    WHERE existing.user_id = NEW.user_id
      AND existing.id <> NEW.id
      AND existing.status = 'confirmed'
      AND NEW.scheduled_at < existing.scheduled_at + (existing.duration_minutes * interval '1 minute')
      AND new_end > existing.scheduled_at
  ) THEN
    RAISE EXCEPTION 'appointment slot already confirmed for this user';
  END IF;

  RETURN NEW;
END;
$$;