import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/config";

/**
 * Server-side Supabase client using the service-role key.
 * Should only be imported from Route Handlers / Server Components.
 */
export const createServerSupabase = () => {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
};

export type SupabaseClient = ReturnType<typeof createServerSupabase>;