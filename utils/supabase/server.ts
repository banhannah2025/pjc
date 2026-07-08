import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export async function createSupabaseServerClient() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    console.error("Missing Supabase server environment variables.", {
      hasUrl: Boolean(SUPABASE_URL),
      hasSecretKey: Boolean(SUPABASE_SECRET_KEY),
    });

    throw new Error("Supabase server environment is not configured.");
  }

  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch (error) {
          console.error("Failed to persist Supabase auth cookies.", error);
        }
      },
    },
  });
}
