UPDATE public.appointments
SET status = 'pending'
WHERE status IN ('proposed', 'booking');

ALTER TABLE public.appointments
  ALTER COLUMN status SET DEFAULT 'pending';

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_status_allowed;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_status_allowed
  CHECK (status IN ('pending', 'confirmed', 'cancelled'));

DROP INDEX IF EXISTS appointments_one_confirmed_per_thread;
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_confirmed_per_thread
  ON public.appointments(thread_id)
  WHERE status = 'confirmed';

CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_pending_per_thread
  ON public.appointments(thread_id)
  WHERE status = 'pending';

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

DROP TRIGGER IF EXISTS trg_prevent_confirmed_appointment_overlap ON public.appointments;
CREATE TRIGGER trg_prevent_confirmed_appointment_overlap
BEFORE INSERT OR UPDATE OF user_id, scheduled_at, duration_minutes, status
ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.prevent_confirmed_appointment_overlap();

ALTER TABLE public.agent_settings
  ALTER COLUMN timezone SET DEFAULT 'Indian/Reunion';