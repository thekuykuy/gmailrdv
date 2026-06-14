DROP INDEX IF EXISTS appointments_one_pending_per_thread;

CREATE INDEX IF NOT EXISTS appointments_user_status_scheduled_idx
  ON public.appointments(user_id, status, scheduled_at);