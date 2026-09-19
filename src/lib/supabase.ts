import "server-only";
import { createClient } from "@supabase/supabase-js";

export function getSupabase() {
  // Read at request time instead of baking this server client's configuration
  // into the build. Deployment/test environments can supply their own project.
  const {
    NEXT_PUBLIC_SUPABASE_URL: url,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: anonKey,
  } = process.env;
  const key = publishableKey || anonKey;
  if (!url || !key || url.includes("your-project")) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (url, options) => fetch(url, { ...options, cache: "no-store" }),
    },
  });
}
