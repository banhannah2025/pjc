import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

type ChatRoom = {
  id: string;
  name: string;
  is_group: boolean;
};

type RoomsSuccessPayload = {
  channels: ChatRoom[];
  directMessages: ChatRoom[];
};

type CreateRoomSuccessPayload = {
  room: ChatRoom;
};

type SecurityRoomsErrorPayload = {
  error: string;
  detail?: string;
};

type CreateRoomRequest = {
  name: string;
  isGroup: boolean;
};

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

export async function GET(): Promise<
  NextResponse<RoomsSuccessPayload | SecurityRoomsErrorPayload>
> {
  try {
    const authResult = await authorizeSecurityCaller();

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("chat_rooms")
      .select("id, name, is_group")
      .order("name", { ascending: true });

    if (error) {
      console.error("Failed to load OUGM security room directory.", error);

      return NextResponse.json(
        {
          error: "Room directory unavailable.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    const rooms = uniqueRooms(Array.isArray(data) ? data : []);

    return NextResponse.json({
      channels: rooms.filter((room) => room.is_group),
      directMessages: rooms.filter((room) => !room.is_group),
    });
  } catch (error) {
    console.error("OUGM security rooms route failed.", error);

    return NextResponse.json(
      {
        error: "Room directory unavailable.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

export async function POST(
  req: Request
): Promise<NextResponse<CreateRoomSuccessPayload | SecurityRoomsErrorPayload>> {
  try {
    const authResult = await authorizeSecurityCaller();

    if (!authResult.ok) {
      return NextResponse.json(
        { error: authResult.error },
        { status: authResult.status }
      );
    }

    const parsedBody = await parseCreateRoomRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("chat_rooms")
      .insert([
        {
          name: parsedBody.value.name,
          is_group: parsedBody.value.isGroup,
        },
      ])
      .select("id, name, is_group")
      .single();

    if (error) {
      console.error("Failed to create OUGM security room.", error);

      return NextResponse.json(
        {
          error: "Unable to create room.",
          detail: error.message,
        },
        { status: 500 }
      );
    }

    if (!isChatRoom(data)) {
      return NextResponse.json(
        { error: "Created room payload had an unexpected shape." },
        { status: 500 }
      );
    }

    return NextResponse.json({ room: data });
  } catch (error) {
    console.error("OUGM security room creation route failed.", error);

    return NextResponse.json(
      {
        error: "Unable to create room.",
        detail: getErrorMessage(error),
      },
      { status: 500 }
    );
  }
}

async function authorizeSecurityCaller(): Promise<
  | { ok: true }
  | {
      ok: false;
      error: string;
      status: 401 | 403;
    }
> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    console.error("Unauthorized OUGM security room request.", userError);
    return { ok: false, error: "Unauthorized", status: 401 };
  }

  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Failed to resolve OUGM room caller role.", error);
    return { ok: false, error: "Unable to verify access.", status: 403 };
  }

  const role = typeof data?.role === "string" ? data.role : null;

  if (role !== "admin" && role !== "staff") {
    console.warn("Blocked OUGM room request from unauthorized role.", {
      userId: user.id,
      role,
    });

    return {
      ok: false,
      error: "Only authorized OUGM staff can access security rooms.",
      status: 403,
    };
  }

  return { ok: true };
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

async function parseCreateRoomRequest(
  req: Request
): Promise<{ ok: true; value: CreateRoomRequest } | { ok: false; error: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return { ok: false, error: "`name` is required." };
  }

  if (typeof body.isGroup !== "boolean") {
    return { ok: false, error: "`isGroup` must be a boolean." };
  }

  const name = body.name.trim();

  if (!body.isGroup && !isValidEmail(name)) {
    return { ok: false, error: "Direct message rooms require a valid email." };
  }

  return {
    ok: true,
    value: {
      name: body.isGroup ? name : name.toLowerCase(),
      isGroup: body.isGroup,
    },
  };
}

function uniqueRooms(rows: unknown[]) {
  const rooms = rows.filter(isChatRoom);
  const seenIds = new Set<string>();
  const seenLabels = new Set<string>();
  const uniqueRoomsList: ChatRoom[] = [];

  for (const room of rooms) {
    const normalizedLabel = `${room.is_group ? "channel" : "dm"}:${room.name
      .trim()
      .toLowerCase()}`;

    if (seenIds.has(room.id) || seenLabels.has(normalizedLabel)) {
      console.warn("Skipping duplicate OUGM chat room row from Supabase.", {
        id: room.id,
        name: room.name,
        is_group: room.is_group,
      });
      continue;
    }

    seenIds.add(room.id);
    seenLabels.add(normalizedLabel);
    uniqueRoomsList.push(room);
  }

  return uniqueRoomsList;
}

function isChatRoom(value: unknown): value is ChatRoom {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    isUuid(value.id) &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    typeof value.is_group === "boolean"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
