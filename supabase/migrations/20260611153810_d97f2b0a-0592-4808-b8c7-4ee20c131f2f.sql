
-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Google connections (Gmail + Calendar OAuth tokens)
CREATE TABLE public.google_connections (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  google_email TEXT,
  access_token TEXT,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT,
  last_poll_at TIMESTAMPTZ,
  last_history_id TEXT,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, DELETE ON public.google_connections TO authenticated;
GRANT ALL ON public.google_connections TO service_role;
ALTER TABLE public.google_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own google read" ON public.google_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own google delete" ON public.google_connections FOR DELETE USING (auth.uid() = user_id);

-- Agent settings
CREATE TABLE public.agent_settings (
  user_id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  agent_enabled BOOLEAN NOT NULL DEFAULT true,
  auto_send BOOLEAN NOT NULL DEFAULT true,
  timezone TEXT NOT NULL DEFAULT 'Europe/Paris',
  working_days INT[] NOT NULL DEFAULT ARRAY[1,2,3,4,5],
  working_hours_start TEXT NOT NULL DEFAULT '09:00',
  working_hours_end TEXT NOT NULL DEFAULT '18:00',
  appointment_duration_minutes INT NOT NULL DEFAULT 30,
  buffer_minutes INT NOT NULL DEFAULT 15,
  language TEXT NOT NULL DEFAULT 'fr',
  signature TEXT DEFAULT '',
  agent_persona TEXT DEFAULT 'Tu es un assistant professionnel, chaleureux et efficace qui aide à planifier les rendez-vous.',
  calendar_id TEXT NOT NULL DEFAULT 'primary',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_settings TO authenticated;
GRANT ALL ON public.agent_settings TO service_role;
ALTER TABLE public.agent_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own settings" ON public.agent_settings FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Email threads (one per Gmail thread/client conversation)
CREATE TABLE public.email_threads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  gmail_thread_id TEXT NOT NULL,
  client_email TEXT NOT NULL,
  client_name TEXT,
  subject TEXT,
  status TEXT NOT NULL DEFAULT 'analyzing', -- analyzing | awaiting_client | confirmed | declined | not_appointment | error
  ai_summary TEXT,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, gmail_thread_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_threads TO authenticated;
GRANT ALL ON public.email_threads TO service_role;
ALTER TABLE public.email_threads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own threads" ON public.email_threads FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Email messages within threads
CREATE TABLE public.email_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id UUID NOT NULL REFERENCES public.email_threads ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  gmail_message_id TEXT,
  direction TEXT NOT NULL, -- inbound | outbound
  from_email TEXT,
  to_email TEXT,
  subject TEXT,
  body TEXT,
  ai_analysis JSONB,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_messages TO authenticated;
GRANT ALL ON public.email_messages TO service_role;
ALTER TABLE public.email_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own messages" ON public.email_messages FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX email_messages_thread_idx ON public.email_messages(thread_id, sent_at);

-- Appointments
CREATE TABLE public.appointments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  thread_id UUID REFERENCES public.email_threads ON DELETE SET NULL,
  client_email TEXT NOT NULL,
  client_name TEXT,
  scheduled_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL DEFAULT 30,
  calendar_event_id TEXT,
  status TEXT NOT NULL DEFAULT 'proposed', -- proposed | confirmed | cancelled
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
GRANT ALL ON public.appointments TO service_role;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own appointments" ON public.appointments FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Activity logs
CREATE TABLE public.activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  thread_id UUID REFERENCES public.email_threads ON DELETE SET NULL,
  type TEXT NOT NULL, -- email_received | analysis | calendar_check | reply_sent | appointment_created | error
  title TEXT NOT NULL,
  description TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.activity_logs TO authenticated;
GRANT ALL ON public.activity_logs TO service_role;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own logs read" ON public.activity_logs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own logs delete" ON public.activity_logs FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX activity_logs_user_idx ON public.activity_logs(user_id, created_at DESC);

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_google_updated BEFORE UPDATE ON public.google_connections FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON public.agent_settings FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_threads_updated BEFORE UPDATE ON public.email_threads FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_appointments_updated BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Auto-create profile + default settings on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.agent_settings (user_id) VALUES (NEW.id);
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_threads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.appointments;
