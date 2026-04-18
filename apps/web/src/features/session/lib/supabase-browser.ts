import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import {
  hasSupabaseBrowserAuthConfig,
  plannerApiConfig,
} from '@/shared/config/planner-api'

let browserSupabaseClient: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient | null {
  if (!hasSupabaseBrowserAuthConfig(plannerApiConfig)) {
    return null
  }

  if (browserSupabaseClient) {
    return browserSupabaseClient
  }

  browserSupabaseClient = createClient(
    plannerApiConfig.supabaseUrl,
    plannerApiConfig.supabasePublishableKey,
    {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  )

  return browserSupabaseClient
}
