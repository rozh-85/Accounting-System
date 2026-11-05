import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Browser client. Only the public anon key is used here; all privileged work
 * happens inside SECURITY DEFINER database functions guarded by RLS and role
 * checks. The service-role key must never be exposed to the browser.
 */
export const supabase: SupabaseClient = createClient(url ?? 'http://localhost:54321', anonKey ?? 'missing-anon-key', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export const ATTACHMENTS_BUCKET = 'attachments';
