import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { internalGlobalOptions } from "./internal-url";

/**
 * Admin Supabase client — использует service role key.
 * Обходит RLS. Использовать ТОЛЬКО в server actions / route handlers.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // Service-role clients do not own a session. A refresh timer would retain
      // the client and the async context of the request that created it.
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
      global: internalGlobalOptions(),
    }
  );
}
