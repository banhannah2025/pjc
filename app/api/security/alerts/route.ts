import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type AlertRequest = {
  isAlertsActive: boolean;
  notificationToken: string | null;
};

type AlertSuccessPayload = {
  isAlertsActive: boolean;
};

type AlertErrorPayload = {
  error: string;
  detail?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export async function POST(
  req: Request
): Promise<NextResponse<AlertSuccessPayload | AlertErrorPayload>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Unauthorized OUGM alert update.", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsedBody = await parseAlertRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const { isAlertsActive, notificationToken } = parsedBody.value;
    const updatePayload = {
      id: user.id,
      full_name: getProfileFullName(user),
      is_on_duty: isAlertsActive,
      notification_token: isAlertsActive ? notificationToken : null,
    };

    const supabaseAdmin = createSupabaseAdminClient();
    const { error } = await supabaseAdmin
      .from("security_profiles")
      .upsert(updatePayload, { onConflict: "id" });

    if (error) {
      console.error("Failed to persist OUGM alert state.", error);

      return NextResponse.json(
        {
          error: "Failed to update alert state.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ isAlertsActive });
  } catch (error) {
    console.error("OUGM alert route failed.", error);

    return NextResponse.json(
      {
        error: "Failed to update alert state.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

export async function GET(): Promise<
  NextResponse<AlertSuccessPayload | AlertErrorPayload>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Unauthorized OUGM alert state request.", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("security_profiles")
      .select("is_on_duty")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to load OUGM alert state.", error);

      return NextResponse.json(
        {
          error: "Failed to load alert state.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ isAlertsActive: data?.is_on_duty === true });
  } catch (error) {
    console.error("OUGM alert state route failed.", error);

    return NextResponse.json(
      {
        error: "Failed to load alert state.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

function createSupabaseAdminClient() {
  if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
    throw new Error("Supabase admin environment is not configured.");
  }

  return createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function getProfileFullName(user: {
  email?: string;
  user_metadata?: Record<string, unknown>;
}) {
  const metadataName = user.user_metadata?.full_name;
  const metadataNameAlt = user.user_metadata?.name;

  if (typeof metadataName === "string" && metadataName.trim().length > 0) {
    return metadataName.trim();
  }

  if (typeof metadataNameAlt === "string" && metadataNameAlt.trim().length > 0) {
    return metadataNameAlt.trim();
  }

  if (user.email && user.email.trim().length > 0) {
    return user.email.trim();
  }

  return "OUGM Security User";
}

async function parseAlertRequest(
  req: Request
): Promise<{ ok: true; value: AlertRequest } | { ok: false; error: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.isAlertsActive !== "boolean") {
    return { ok: false, error: "`isAlertsActive` must be a boolean." };
  }

  if (
    body.notificationToken !== null &&
    typeof body.notificationToken !== "string"
  ) {
    return {
      ok: false,
      error: "`notificationToken` must be a string or null.",
    };
  }

  if (body.isAlertsActive && !body.notificationToken) {
    return {
      ok: false,
      error: "`notificationToken` is required when alerts are active.",
    };
  }

  return {
    ok: true,
    value: {
      isAlertsActive: body.isAlertsActive,
      notificationToken: body.notificationToken,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error.";
}
