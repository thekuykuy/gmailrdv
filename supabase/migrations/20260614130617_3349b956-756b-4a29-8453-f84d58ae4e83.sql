REVOKE EXECUTE ON FUNCTION public.claim_google_processing_lock(uuid, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_google_processing_lock(uuid, integer) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_google_processing_lock(uuid, integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_google_processing_lock(uuid, integer) TO service_role;

REVOKE EXECUTE ON FUNCTION public.release_google_processing_lock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_google_processing_lock(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_google_processing_lock(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.release_google_processing_lock(uuid) TO service_role;