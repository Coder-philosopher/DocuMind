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
    global: {
      // Next.js patches global fetch with a Data Cache; without this, GET
      // handlers can serve build-time snapshots of Supabase responses.
      fetch: (input, init) =>
        fetch(input, { ...(init ?? {}), cache: "no-store" }),
    },
  });
};

export type SupabaseClient = ReturnType<typeof createServerSupabase>;