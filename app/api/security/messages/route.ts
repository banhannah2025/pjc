import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type SendSecurityMessageRequest = {
  roomId: string;
  text: string;
  imageUrl?: string | null;
};

type SecurityMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_name: string | null;
  text: string | null;
  image_url: string | null;
  created_at: string | null;
};

type SendSecurityMessageSuccess = {
  message: SecurityMessage;
};

type LoadSecurityMessagesSuccess = {
  messages: SecurityMessage[];
};

type SendSecurityMessageError = {
  error: string;
  detail?: string;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export async function GET(
  req: Request
): Promise<
  NextResponse<LoadSecurityMessagesSuccess | SendSecurityMessageError>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Unauthorized OUGM security message load.", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = await loadUserRole(user.id, supabase);

    if (role !== "admin" && role !== "staff") {
      console.warn("Blocked OUGM security message load from unauthorized role.", {
        userId: user.id,
        role,
      });

      return NextResponse.json(
        { error: "Only authorized OUGM staff can load security messages." },
        { status: 403 }
      );
    }

    const roomId = new URL(req.url).searchParams.get("roomId");

    if (!roomId || !isUuid(roomId)) {
      return NextResponse.json(
        { error: "`roomId` must be a valid UUID string." },
        { status: 400 }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error: loadError } = await supabaseAdmin
      .from("security_messages")
      .select("*")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true });

    if (loadError) {
      console.error("Failed to load OUGM security messages.", loadError);

      return NextResponse.json(
        {
          error: "Unable to load security messages.",
          detail: loadError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      messages: Array.isArray(data) ? (data as SecurityMessage[]) : [],
    });
  } catch (error) {
    console.error("OUGM security message load route failed.", error);

    return NextResponse.json(
      {
        error: "Unable to load security messages.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request
): Promise<
  NextResponse<SendSecurityMessageSuccess | SendSecurityMessageError>
> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Unauthorized OUGM security message request.", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = await loadUserRole(user.id, supabase);

    if (role !== "admin" && role !== "staff") {
      console.warn("Blocked OUGM security message from unauthorized role.", {
        userId: user.id,
        role,
      });

      return NextResponse.json(
        { error: "Only authorized OUGM staff can send security messages." },
        { status: 403 }
      );
    }

    const parsedBody = await parseSecurityMessageRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const { roomId, text, imageUrl } = parsedBody.value;
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error: insertError } = await supabaseAdmin
      .from("security_messages")
      .insert({
        room_id: roomId,
        sender_id: user.id,
        sender_name: user.email ?? "Security Operator",
        text: text || null,
        image_url: imageUrl ?? null,
      })
      .select("*")
      .single();

    if (insertError) {
      console.error("Failed to insert OUGM security message.", insertError);

      return NextResponse.json(
        {
          error: "Unable to send security message.",
          detail: insertError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ message: data as SecurityMessage });
  } catch (error) {
    console.error("OUGM security message route failed.", error);

    return NextResponse.json(
      {
        error: "Unable to send security message.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

async function loadUserRole(
  userId: string,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>
) {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to resolve OUGM security message caller role.", error);
    return null;
  }

  return typeof data?.role === "string" ? data.role : null;
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

async function parseSecurityMessageRequest(
  req: Request
): Promise<
  | { ok: true; value: SendSecurityMessageRequest }
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

  if (typeof body.roomId !== "string" || !isUuid(body.roomId)) {
    return { ok: false, error: "`roomId` must be a valid UUID string." };
  }

  if (typeof body.text !== "string") {
    return { ok: false, error: "`text` must be a string." };
  }

  if (body.imageUrl !== undefined && body.imageUrl !== null) {
    if (typeof body.imageUrl !== "string" || !isValidHttpUrl(body.imageUrl)) {
      return {
        ok: false,
        error: "`imageUrl` must be a valid HTTP URL string or null.",
      };
    }
  }

  const text = body.text.trim();
  const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : null;

  if (!text && !imageUrl) {
    return {
      ok: false,
      error: "A message must include text or an image attachment.",
    };
  }

  return {
    ok: true,
    value: {
      roomId: body.roomId,
      text,
      imageUrl,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
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
