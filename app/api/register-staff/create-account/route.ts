import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type CreateStaffAccountSuccessPayload = {
  ok: boolean;
};

type CreateStaffAccountErrorPayload = {
  error: string;
};

export async function POST(
  req: Request
): Promise<
  NextResponse<CreateStaffAccountSuccessPayload | CreateStaffAccountErrorPayload>
> {
  try {
    const parsedBody = await parseCreateStaffAccountRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: invite, error: inviteError } = await supabaseAdmin
      .from("allowed_invites")
      .select("email, assigned_role")
      .eq("email", parsedBody.email)
      .maybeSingle();

    if (inviteError) {
      console.error("Failed to verify staff whitelist during account creation.", {
        email: parsedBody.email,
        error: inviteError.message || inviteError,
      });

      return NextResponse.json(
        { error: "Unable to verify staff authorization." },
        { status: 500 }
      );
    }

    if (!invite) {
      return NextResponse.json(
        {
          error:
            "This email address has not been pre-authorized by an administrator.",
        },
        { status: 403 }
      );
    }

    const assignedRole = invite.assigned_role === "admin" ? "admin" : "staff";
    const { data: authData, error: createUserError } =
      await supabaseAdmin.auth.admin.createUser({
        email: parsedBody.email,
        password: parsedBody.password,
        email_confirm: true,
        user_metadata: {
          role: assignedRole,
        },
        app_metadata: {
          role: assignedRole,
        },
      });

    if (createUserError || !authData.user) {
      console.error("Failed to create confirmed OUGM staff Auth user.", {
        email: parsedBody.email,
        error: createUserError?.message || createUserError,
      });

      return NextResponse.json(
        {
          error:
            createUserError?.message ??
            "Unable to create staff account. Please try again.",
        },
        { status: 400 }
      );
    }

    const { error: profileError } = await supabaseAdmin.from("profiles").upsert(
      {
        id: authData.user.id,
        email: parsedBody.email,
        role: assignedRole,
      },
      { onConflict: "id" }
    );

    if (profileError) {
      console.error("Failed to upsert OUGM staff profile after Auth creation.", {
        email: parsedBody.email,
        userId: authData.user.id,
        error: profileError.message || profileError,
      });

      return NextResponse.json(
        { error: "Staff account was created, but profile setup failed." },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Staff account creation route failed.", error);

    return NextResponse.json(
      { error: "Unable to create staff account." },
      { status: 500 }
    );
  }
}

async function parseCreateStaffAccountRequest(
  req: Request
): Promise<
  | { ok: true; email: string; password: string }
  | { ok: false; error: string }
> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.email !== "string") {
    return { ok: false, error: "`email` must be provided." };
  }

  if (typeof body.password !== "string" || body.password.length < 8) {
    return {
      ok: false,
      error: "`password` must be at least 8 characters.",
    };
  }

  const email = body.email.trim().toLowerCase();

  if (!isValidEmail(email)) {
    return { ok: false, error: "`email` must be a valid email address." };
  }

  return { ok: true, email, password: body.password };
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase staff creation environment variables.", {
      hasUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });

    throw new Error("Supabase staff creation is not configured.");
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
