-- Trigger functions are invoked by their triggers and are not public RPC endpoints.
revoke all on function public.handle_new_auth_user() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
