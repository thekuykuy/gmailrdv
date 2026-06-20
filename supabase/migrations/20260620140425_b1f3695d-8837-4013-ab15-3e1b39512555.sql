REVOKE EXECUTE ON FUNCTION public.update_poll_cron_interval(integer) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_poll_cron_interval(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_poll_cron_interval(integer) TO service_role;