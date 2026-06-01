import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Safe during build / static generation when env vars are not present
  if (!url || !key || typeof window === 'undefined') {
    return {
      auth: {
        signInWithOAuth: async () => ({ error: null }),
        signInWithOtp: async () => ({ error: null }),
        signOut: async () => ({ error: null }),
        getUser: async () => ({ data: { user: null }, error: null }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: () => ({
        select: async () => ({ data: [], error: null }),
        insert: async () => ({ data: null, error: null }),
        delete: async () => ({ data: null, error: null }),
        eq: function () { return this; },
        order: function () { return this; },
      }),
    } as any;
  }

  return createBrowserClient(url, key);
}
