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
  sender_name?: string | null;
  profiles?: SenderProfile | null;
  text: string | null;
  image_url: string | null;
  created_at: string | null;
};

type SenderProfile = {
  id?: string | null;
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
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
const MESSAGE_TEXT_COLUMNS = [
  "text_content",
  "text",
  "content",
  "message",
  "body",
  "message_text",
];
const MESSAGE_IMAGE_COLUMNS = ["image_url", "attachment_url", "media_url", "file_url"];

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
    const { data, error: loadError } = await loadMessagesForRoom(
      supabaseAdmin,
      roomId
    );

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

    const messages = await enrichMessagesWithSenderProfiles({
      supabaseAdmin,
      rows: Array.isArray(data) ? data : [],
      currentUserEmail: user.email ?? null,
      currentUserId: user.id,
    });

    return NextResponse.json({ messages });
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
    const senderProfile = await loadSenderProfile(supabaseAdmin, user.id);
    const { data, error: insertError } = await insertSecurityMessage({
      supabaseAdmin,
      roomId,
      senderId: user.id,
      text,
      imageUrl: imageUrl ?? null,
    });

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

    return NextResponse.json({
      message: {
        ...normalizeSecurityMessage(data),
        profiles: senderProfile,
        sender_name: formatSenderDisplayName(senderProfile) ?? user.email ?? null,
      },
    });
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

async function loadMessagesForRoom(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  roomId: string
) {
  return supabaseAdmin
    .from("security_messages")
    .select("*")
    .eq("room_id", roomId)
    .order("created_at", { ascending: true });
}

async function enrichMessagesWithSenderProfiles({
  supabaseAdmin,
  rows,
  currentUserEmail,
  currentUserId,
}: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  rows: unknown[];
  currentUserEmail: string | null;
  currentUserId: string;
}) {
  const normalizedMessages = rows.map(normalizeSecurityMessage);
  const senderIds = Array.from(
    new Set(
      normalizedMessages
        .map((message) => message.sender_id)
        .filter((senderId): senderId is string => Boolean(senderId))
    )
  );

  if (senderIds.length === 0) {
    return normalizedMessages;
  }

  const profileMap = await loadSenderProfiles(supabaseAdmin, senderIds);
  const missingSenderIds = senderIds.filter((senderId) => !profileMap.has(senderId));
  const authProfileMap = await loadAuthSenderProfiles(
    supabaseAdmin,
    missingSenderIds
  );

  return normalizedMessages.map((message) => {
    const sessionProfile =
      message.sender_id === currentUserId && currentUserEmail
        ? {
          id: currentUserId,
          email: currentUserEmail,
          first_name: null,
          last_name: null,
          name: null,
        }
        : null;
    const profile = message.sender_id
      ? profileMap.get(message.sender_id) ??
        authProfileMap.get(message.sender_id) ??
        sessionProfile
      : null;

    return {
      ...message,
      profiles: profile,
      sender_name:
        formatSenderDisplayName(profile) ?? message.sender_name ?? null,
    };
  });
}

async function loadSenderProfiles(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  senderIds: string[]
) {
  const profileMap = new Map<string, SenderProfile>();
  const richProfiles = await supabaseAdmin
    .from("profiles")
    .select("id, email, first_name, last_name")
    .in("id", senderIds);

  if (!richProfiles.error) {
    for (const profile of Array.isArray(richProfiles.data)
      ? richProfiles.data
      : []) {
      const normalizedProfile = normalizeSenderProfile(profile);

      if (normalizedProfile?.id) {
        profileMap.set(normalizedProfile.id, normalizedProfile);
      }
    }

    await enrichProfileMapWithInviteNames(supabaseAdmin, profileMap);
    return profileMap;
  }

  if (!isMissingColumnError(richProfiles.error.message)) {
    console.error("Failed to load sender profile metadata.", richProfiles.error);
    return profileMap;
  }

  const emailOnlyProfiles = await supabaseAdmin
    .from("profiles")
    .select("id, email")
    .in("id", senderIds);

  if (emailOnlyProfiles.error) {
    console.error("Failed to load sender profile emails.", emailOnlyProfiles.error);
    return profileMap;
  }

  for (const profile of Array.isArray(emailOnlyProfiles.data)
    ? emailOnlyProfiles.data
    : []) {
    const normalizedProfile = normalizeSenderProfile(profile);

    if (normalizedProfile?.id) {
      profileMap.set(normalizedProfile.id, normalizedProfile);
    }
  }

  await enrichProfileMapWithInviteNames(supabaseAdmin, profileMap);
  return profileMap;
}

async function enrichProfileMapWithInviteNames(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  profileMap: Map<string, SenderProfile>
) {
  const emailsNeedingNames = Array.from(profileMap.values())
    .filter(
      (profile) => profile.email && !(profile.first_name && profile.last_name)
    )
    .map((profile) => profile.email as string);

  if (emailsNeedingNames.length === 0) {
    return;
  }

  const { data, error } = await supabaseAdmin
    .from("allowed_invites")
    .select("email, first_name, last_name")
    .in("email", emailsNeedingNames);

  if (error) {
    console.warn("Failed to load invite names for sender profiles.", {
      error: error.message,
    });
    return;
  }

  const inviteNameMap = new Map<
    string,
    Pick<SenderProfile, "first_name" | "last_name">
  >();

  for (const invite of Array.isArray(data) ? data : []) {
    const email = typeof invite.email === "string" ? invite.email : null;
    const firstName =
      typeof invite.first_name === "string" ? invite.first_name : null;
    const lastName =
      typeof invite.last_name === "string" ? invite.last_name : null;

    if (email && firstName && lastName) {
      inviteNameMap.set(email, {
        first_name: firstName,
        last_name: lastName,
      });
    }
  }

  for (const [senderId, profile] of profileMap) {
    if (!profile.email || (profile.first_name && profile.last_name)) {
      continue;
    }

    const inviteNames = inviteNameMap.get(profile.email);

    if (inviteNames) {
      profileMap.set(senderId, {
        ...profile,
        ...inviteNames,
      });
    }
  }
}

async function loadAuthSenderProfiles(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  senderIds: string[]
) {
  const profileMap = new Map<string, SenderProfile>();

  await Promise.all(
    senderIds.map(async (senderId) => {
      try {
        const { data, error } = await supabaseAdmin.auth.admin.getUserById(
          senderId
        );

        if (error) {
          console.warn("Failed to resolve sender email from Supabase Auth.", {
            senderId,
            error: error.message,
          });
          return;
        }

        if (data.user?.email) {
          profileMap.set(senderId, {
            id: senderId,
            email: data.user.email,
            first_name: readMetadataString(data.user.user_metadata, "first_name"),
            last_name: readMetadataString(data.user.user_metadata, "last_name"),
            name: null,
          });
        }
      } catch (error) {
        console.warn("Sender auth lookup failed.", {
          senderId,
          error: getErrorMessage(error),
        });
      }
    })
  );

  return profileMap;
}

async function loadSenderProfile(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  senderId: string
): Promise<SenderProfile | null> {
  const richProfile = await supabaseAdmin
    .from("profiles")
    .select("email, first_name, last_name")
    .eq("id", senderId)
    .maybeSingle();

  if (!richProfile.error) {
    const profile = await enrichProfileWithInviteName(
      supabaseAdmin,
      normalizeSenderProfile(richProfile.data)
    );

    if (hasSenderDisplayValue(profile)) {
      return profile;
    }

    const authProfiles = await loadAuthSenderProfiles(supabaseAdmin, [senderId]);
    return authProfiles.get(senderId) ?? null;
  }

  if (!isMissingColumnError(richProfile.error.message)) {
    console.error("Failed to load sender profile metadata.", richProfile.error);
    const authProfiles = await loadAuthSenderProfiles(supabaseAdmin, [senderId]);
    return authProfiles.get(senderId) ?? null;
  }

  const emailOnlyProfile = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("id", senderId)
    .maybeSingle();

  if (emailOnlyProfile.error) {
    console.error("Failed to load sender profile email.", emailOnlyProfile.error);
    const authProfiles = await loadAuthSenderProfiles(supabaseAdmin, [senderId]);
    return authProfiles.get(senderId) ?? null;
  }

  const profile = await enrichProfileWithInviteName(
    supabaseAdmin,
    normalizeSenderProfile(emailOnlyProfile.data)
  );

  if (hasSenderDisplayValue(profile)) {
    return profile;
  }

  const authProfiles = await loadAuthSenderProfiles(supabaseAdmin, [senderId]);
  return authProfiles.get(senderId) ?? null;
}

async function enrichProfileWithInviteName(
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>,
  profile: SenderProfile | null
) {
  if (!profile?.email || (profile.first_name && profile.last_name)) {
    return profile;
  }

  const { data, error } = await supabaseAdmin
    .from("allowed_invites")
    .select("first_name, last_name")
    .eq("email", profile.email)
    .maybeSingle();

  if (error) {
    console.warn("Failed to load invite name for sender profile.", {
      email: profile.email,
      error: error.message,
    });
    return profile;
  }

  const firstName = typeof data?.first_name === "string" ? data.first_name : null;
  const lastName = typeof data?.last_name === "string" ? data.last_name : null;

  if (!firstName || !lastName) {
    return profile;
  }

  return {
    ...profile,
    first_name: firstName,
    last_name: lastName,
  };
}

async function insertSecurityMessage({
  supabaseAdmin,
  roomId,
  senderId,
  text,
  imageUrl,
}: {
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>;
  roomId: string;
  senderId: string;
  text: string;
  imageUrl: string | null;
}) {
  const imageColumnCandidates = imageUrl ? MESSAGE_IMAGE_COLUMNS : [null];
  let lastError: { message?: string } | null = null;

  for (const textColumn of MESSAGE_TEXT_COLUMNS) {
    for (const imageColumn of imageColumnCandidates) {
      const insertPayload: Record<string, string | null> = {
        room_id: roomId,
        sender_id: senderId,
        [textColumn]: text || null,
      };

      if (imageColumn && imageUrl) {
        insertPayload[imageColumn] = imageUrl;
      }

      const { data, error } = await supabaseAdmin
        .from("security_messages")
        .insert(insertPayload)
        .select("*")
        .single();

      if (!error) {
        return { data, error: null };
      }

      lastError = error;

      if (!isMissingColumnError(error.message)) {
        return { data: null, error };
      }

      console.warn("Retrying OUGM security message insert with schema fallback.", {
        skippedTextColumn: textColumn,
        skippedImageColumn: imageColumn,
        error: error.message,
      });
    }
  }

  return {
    data: null,
    error:
      lastError ??
      new Error("No compatible security message content column was found."),
  };
}

function normalizeSecurityMessage(value: unknown): SecurityMessage {
  const record = isRecord(value) ? value : {};
  const profiles = normalizeSenderProfile(record.profiles);

  return {
    id: typeof record.id === "string" ? record.id : crypto.randomUUID(),
    room_id: typeof record.room_id === "string" ? record.room_id : "",
    sender_id: typeof record.sender_id === "string" ? record.sender_id : null,
    sender_name:
      formatSenderDisplayName(profiles) ??
      (typeof record.sender_name === "string" ? record.sender_name : null),
    profiles,
    text: readFirstString(record, MESSAGE_TEXT_COLUMNS),
    image_url: readFirstString(record, MESSAGE_IMAGE_COLUMNS),
    created_at:
      typeof record.created_at === "string" ? record.created_at : null,
  };
}

function normalizeSenderProfile(value: unknown): SenderProfile | null {
  if (!isRecord(value)) {
    return null;
  }

  const email = typeof value.email === "string" ? value.email : null;
  const firstName =
    typeof value.first_name === "string" ? value.first_name : null;
  const lastName = typeof value.last_name === "string" ? value.last_name : null;
  const name = typeof value.name === "string" ? value.name : null;
  const id = typeof value.id === "string" ? value.id : null;

  if (!email && !firstName && !lastName && !name) {
    return null;
  }

  return { id, email, first_name: firstName, last_name: lastName, name };
}

function hasSenderDisplayValue(profile: SenderProfile | null) {
  return Boolean(
    profile?.first_name || profile?.last_name || profile?.email || profile?.name
  );
}

function formatSenderDisplayName(profile: SenderProfile | null) {
  if (!profile) {
    return null;
  }

  if (profile.first_name && profile.last_name) {
    return `${profile.first_name} ${profile.last_name}`;
  }

  return profile.email ?? profile.name ?? null;
}

function readMetadataString(
  metadata: Record<string, unknown> | null | undefined,
  key: string
) {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return null;
}

function isMissingColumnError(message: string | undefined) {
  return (
    typeof message === "string" &&
    message.includes("Could not find the") &&
    message.includes("column")
  );
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
