import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ValidateInviteSuccessPayload = {
  authorized: boolean;
};

type ValidateInviteErrorPayload = {
  error: string;
};

export async function POST(
  req: Request
): Promise<
  NextResponse<ValidateInviteSuccessPayload | ValidateInviteErrorPayload>
> {
  try {
    const parsedBody = await parseValidateInviteRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("allowed_invites")
      .select("email")
      .eq("email", parsedBody.email)
      .maybeSingle();

    if (error) {
      console.error("Failed to validate staff invite whitelist.", {
        email: parsedBody.email,
        error: error.message || error,
      });

      return NextResponse.json(
        { error: "Unable to validate staff invite." },
        { status: 500 }
      );
    }

    return NextResponse.json({ authorized: Boolean(data) });
  } catch (error) {
    console.error("Staff invite validation route failed.", error);

    return NextResponse.json(
      { error: "Unable to validate staff invite." },
      { status: 500 }
    );
  }
}

async function parseValidateInviteRequest(
  req: Request
): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body) || typeof body.email !== "string") {
    return { ok: false, error: "`email` must be provided." };
  }

  const email = body.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    return { ok: false, error: "`email` must be a valid email address." };
  }

  return { ok: true, email };
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase invite validation environment variables.", {
      hasUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });

    throw new Error("Supabase invite validation is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
