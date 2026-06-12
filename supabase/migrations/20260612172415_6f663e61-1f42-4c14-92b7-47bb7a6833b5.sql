
-- Set default timezone to Réunion island and update existing users
ALTER TABLE public.agent_settings ALTER COLUMN timezone SET DEFAULT 'Indian/Reunion';
UPDATE public.agent_settings SET timezone = 'Indian/Reunion' WHERE timezone = 'Europe/Paris';

-- Prevent duplicate processing of the same Gmail message
CREATE UNIQUE INDEX IF NOT EXISTS email_messages_unique_gmail_msg
  ON public.email_messages(thread_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

-- Prevent duplicate calendar events per thread
CREATE UNIQUE INDEX IF NOT EXISTS appointments_one_confirmed_per_thread
  ON public.appointments(thread_id)
  WHERE status = 'confirmed';
