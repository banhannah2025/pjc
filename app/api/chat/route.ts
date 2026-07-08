import OpenAI from "openai";
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { createSupabaseServerClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

interface ChatRequest {
  message: string;
  proToggle: boolean;
}

type TriageIntent = "CODE" | "ACADEMIC" | "GENERAL";

type ModelActor = "gpt-5.5-pro" | "gpt-4o-mini" | "gpt-5.4";
type UserRole = "admin" | "staff" | "guest";
type ToolName = "fetch_live_web_context" | "query_local_db" | "manage_staff_access";
type StaffAccessAction = "invite" | "remove";

type ChatSuccessPayload = {
  text: string;
  modelActor: ModelActor;
  usedWebSearch?: boolean;
};

type ChatErrorPayload = {
  error: string;
  detail?: string;
};

type SecurityContext = {
  userId: string;
  role: UserRole;
  systemInstruction: string;
  allowedTools: Set<ToolName>;
};

type StaffAccessCommand = {
  action: StaffAccessAction;
  email: string;
};

const PRO_MODEL = "gpt-5.5-pro" satisfies ModelActor;
const TRIAGE_MODEL = "gpt-4o-mini" satisfies ModelActor;
const CODE_MODEL = "gpt-4o-mini" satisfies ModelActor;
const ACADEMIC_MODEL = "gpt-5.4" satisfies ModelActor;
const GENERAL_MODEL = "gpt-4o-mini" satisfies ModelActor;
const UNAUTHORIZED_ADMIN_COMMAND_MESSAGE = "Unauthorized command attempt logged.";
const OPERATIONAL_GATEWAY_SYSTEM_INSTRUCTION =
  "You are an operational gateway agent. When a user types a command starting with a slash, parse the arguments, invoke the 'manage_staff_access' tool immediately, and present a professional confirmation message back to the terminal view.";
const GUEST_SECURITY_SYSTEM_INSTRUCTION =
  "User is an unauthenticated general guest. Access to all internal security dashboard files, database tables, and metrics is strictly classified. Confine responses purely to general public domain data.";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY ?? "missing-openai-api-key",
});

export async function POST(
  req: Request
): Promise<NextResponse<ChatSuccessPayload | ChatErrorPayload>> {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      console.error("Unauthorized chat request.", userError);
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const securityContext = await buildSecurityContext(supabase, user.id);
    const parsedBody = await parseChatRequest(req);
    if (!parsedBody.ok) {
      console.error("Invalid chat request body.", parsedBody.error);
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const { message, proToggle } = parsedBody.value;
    const staffAccessCommand = parseStaffAccessSlashCommand(message);
    if (staffAccessCommand) {
      const text = await executeStaffAccessCommand(
        staffAccessCommand,
        supabase,
        securityContext
      );

      return chatResponse(text, GENERAL_MODEL);
    }

    assertOpenAIEnvironment();

    const isProOverride = proToggle || startsWithProCommand(message);
    const requestOrigin = new URL(req.url).origin;

    if (isProOverride) {
      const prompt = stripProCommand(message);
      const text = await generateModelText({
        model: PRO_MODEL,
        instructions: withSecurityInstruction(
          "You are the premium orchestration model. Answer with depth, precision, and clear practical guidance.",
          securityContext
        ),
        input: prompt,
      });

      return chatResponse(text, PRO_MODEL);
    }

    const triage = await classifyIntent(message);
    const routed = await routeByIntent(
      triage,
      message,
      requestOrigin,
      supabase,
      securityContext
    );

    return chatResponse(routed.text, routed.modelActor, routed.usedWebSearch);
  } catch (error) {
    console.error("Chat route failed.", error);

    return NextResponse.json(
      {
        error: "Chat orchestration failed.",
        detail: toPublicErrorMessage(error),
      },
      { status: statusFromError(error) }
    );
  }
}

async function parseChatRequest(
  req: Request
): Promise<{ ok: true; value: ChatRequest } | { ok: false; error: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch (error) {
    console.error("Failed to parse chat request JSON.", error);
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return { ok: false, error: "`message` must be a non-empty string." };
  }

  if (typeof body.proToggle !== "boolean") {
    return { ok: false, error: "`proToggle` must be a boolean." };
  }

  return {
    ok: true,
    value: {
      message: body.message,
      proToggle: body.proToggle,
    },
  };
}

async function classifyIntent(message: string): Promise<TriageIntent> {
  const triageText = await generateModelText({
    model: TRIAGE_MODEL,
    instructions:
      "Classify the user's intent. Reply with exactly one word and no punctuation: CODE, ACADEMIC, or GENERAL. CODE means programming, scripts, shell commands, automation, file execution parameters, debugging, configuration, or code generation. ACADEMIC means science, English, reasoning, legal, law, law enforcement, formal analysis, or deep domain explanation. GENERAL means all other conversational requests.",
    input: message,
  });

  const normalized = triageText.trim().toUpperCase();

  if (
    normalized === "CODE" ||
    normalized === "ACADEMIC" ||
    normalized === "GENERAL"
  ) {
    return normalized;
  }

  console.error("Unexpected triage result; defaulting to GENERAL.", {
    triageText,
  });

  return "GENERAL";
}

async function routeByIntent(
  triage: TriageIntent,
  message: string,
  requestOrigin: string,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  securityContext: SecurityContext
): Promise<ChatSuccessPayload> {
  if (triage === "CODE") {
    const routed = await generateModelTextWithHybridTools({
      model: CODE_MODEL,
      instructions:
        "You are a code, command, and script-file operations specialist. Provide precise implementation steps, commands, and file-operation guidance when requested. Prefer safe, explicit, copy-ready outputs. Call out destructive or security-sensitive operations before suggesting them.",
      input: message,
      requestOrigin,
      supabase,
      securityContext,
    });

    return {
      text: routed.text,
      modelActor: CODE_MODEL,
      usedWebSearch: routed.usedWebSearch,
    };
  }

  if (triage === "ACADEMIC") {
    const routed = await generateModelTextWithHybridTools({
      model: ACADEMIC_MODEL,
      instructions:
        "You are a deep reasoning specialist for science, English, reasoning, legal, and law-enforcement topics. Be rigorous, careful with uncertainty, and avoid inventing legal or factual authority.",
      input: message,
      requestOrigin,
      supabase,
      securityContext,
    });

    return {
      text: routed.text,
      modelActor: ACADEMIC_MODEL,
      usedWebSearch: routed.usedWebSearch,
    };
  }

  const routed = await generateModelTextWithHybridTools({
    model: GENERAL_MODEL,
    instructions:
      "You are a concise, helpful conversational assistant. Answer naturally and directly.",
    input: message,
    requestOrigin,
    supabase,
    securityContext,
  });

  return {
    text: routed.text,
    modelActor: GENERAL_MODEL,
    usedWebSearch: routed.usedWebSearch,
  };
}

async function generateModelText({
  model,
  instructions,
  input,
}: {
  model: ModelActor;
  instructions: string;
  input: string;
}): Promise<string> {
  const response = await withRetry(async () => {
    return openai.responses.create({
      model,
      instructions,
      input,
    });
  });

  const text = response.output_text.trim();

  if (!text) {
    console.error("OpenAI returned an empty text response.", { model });
    throw new Error(`OpenAI model ${model} returned an empty response.`);
  }

  return text;
}

async function generateModelTextWithHybridTools({
  model,
  instructions,
  input,
  requestOrigin,
  supabase,
  securityContext,
}: {
  model: ModelActor;
  instructions: string;
  input: string;
  requestOrigin: string;
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  securityContext: SecurityContext;
}): Promise<{ text: string; usedWebSearch: boolean }> {
  const tools = buildAllowedTools(securityContext);
  let usedWebSearch = false;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${withSecurityInstruction(
        `${OPERATIONAL_GATEWAY_SYSTEM_INSTRUCTION}\n\n${instructions}`,
        securityContext
      )}

You have access to a tool named fetch_live_web_context. Use it when external facts, live news, recent public information, or public domain texts such as the World English Bible would improve the answer. This is especially appropriate for spiritual or theological context such as forgiveness when exact public-domain passages would help. Do not use the tool for ordinary conversation or when the answer can be completed from the user's prompt alone.`,
    },
    {
      role: "user",
      content: input,
    },
  ];

  const firstResponse = await withRetry(() =>
    openai.chat.completions.create({
      model,
      messages,
      tools,
      tool_choice: "auto",
    })
  );

  const firstChoice = firstResponse.choices[0]?.message;
  const toolCalls = firstChoice?.tool_calls ?? [];

  if (toolCalls.length === 0) {
    const directText = firstChoice?.content?.trim();

    if (!directText) {
      throw new Error(`OpenAI model ${model} returned an empty response.`);
    }

    return { text: directText, usedWebSearch: false };
  }

  messages.push(firstChoice);

  for (const toolCall of toolCalls) {
    if (toolCall.type !== "function") {
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: `Unsupported non-function tool call: ${toolCall.type}`,
      });
      continue;
    }

    assertToolExecutionAllowed(toolCall.function.name, securityContext);

    if (toolCall.function.name === "manage_staff_access") {
      if (securityContext.role !== "admin") {
        console.error("Blocked non-admin staff management tool call.", {
          userId: securityContext.userId,
          role: securityContext.role,
        });

        return {
          text: UNAUTHORIZED_ADMIN_COMMAND_MESSAGE,
          usedWebSearch,
        };
      }

      const staffAccessCommand = parseStaffAccessToolArguments(
        toolCall.function.arguments
      );
      const toolContext = await executeStaffAccessCommand(
        staffAccessCommand,
        supabase,
        securityContext
      );

      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolContext,
      });
      continue;
    }

    if (toolCall.function.name === "fetch_live_web_context") {
      const args = parseWebSearchToolArguments(toolCall.function.arguments);
      const webContext = await searchTheWeb(args.query, requestOrigin).catch(
        (error) => `Web search unavailable: ${toPublicErrorMessage(error)}`
      );

      usedWebSearch = true;
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: webContext,
      });
    }
  }

  const finalResponse = await withRetry(() =>
    openai.chat.completions.create({
      model,
      messages,
    })
  );

  const finalText = finalResponse.choices[0]?.message.content?.trim();

  if (!finalText) {
    throw new Error(`OpenAI model ${model} returned an empty final response.`);
  }

  return { text: finalText, usedWebSearch };
}

async function buildSecurityContext(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<SecurityContext> {
  const role = await fetchUserRole(supabase, userId);
  const allowedTools = new Set<ToolName>(
    role === "guest"
      ? ["fetch_live_web_context"]
      : role === "admin"
        ? ["fetch_live_web_context", "query_local_db", "manage_staff_access"]
        : ["fetch_live_web_context", "query_local_db"]
  );

  return {
    userId,
    role,
    systemInstruction: role === "guest" ? GUEST_SECURITY_SYSTEM_INSTRUCTION : "",
    allowedTools,
  };
}

async function fetchUserRole(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  userId: string
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Failed to load chat caller profile role; using guest policy.", {
      userId,
      error: error.message || error,
    });
    return "guest";
  }

  return isUserRole(data?.role) ? data.role : "guest";
}

function withSecurityInstruction(
  instructions: string,
  securityContext: SecurityContext
) {
  return [instructions, securityContext.systemInstruction]
    .filter(Boolean)
    .join("\n\nSECURITY CONTEXT:\n");
}

function buildAllowedTools(
  securityContext: SecurityContext
): OpenAI.Chat.Completions.ChatCompletionTool[] {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [];

  if (securityContext.allowedTools.has("fetch_live_web_context")) {
    tools.push({
      type: "function",
      function: {
        name: "fetch_live_web_context",
        description:
          "Use this tool to search the internet for external facts, live news, or public domain texts like the World English Bible when answering questions regarding spiritual or theological context like forgiveness.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The concise web search query needed to answer the user.",
            },
          },
          required: ["query"],
          additionalProperties: false,
        },
      },
    });
  }

  if (securityContext.allowedTools.has("manage_staff_access")) {
    tools.push({
      type: "function",
      function: {
        name: "manage_staff_access",
        description:
          "Executes administrative staff credential provisioning or removal. Trigger this tool whenever the user passes explicit slash commands matching '/ougm-invite-staff [email]' or '/ougm-remove-staff [email]'.",
        parameters: {
          type: "object",
          properties: {
            action: {
              type: "string",
              enum: ["invite", "remove"],
              description:
                "Use invite for /ougm-invite-staff and remove for /ougm-remove-staff.",
            },
            email: {
              type: "string",
              format: "email",
              description: "The staff email address to provision or remove.",
            },
          },
          required: ["action", "email"],
          additionalProperties: false,
        },
      },
    });
  }

  return tools;
}

function assertToolExecutionAllowed(
  requestedToolName: string,
  securityContext: SecurityContext
) {
  if (!isToolName(requestedToolName)) {
    throw new Error(`Blocked unknown tool execution request: ${requestedToolName}.`);
  }

  if (!securityContext.allowedTools.has(requestedToolName)) {
    console.error("Blocked unauthorized LLM tool execution request.", {
      userId: securityContext.userId,
      role: securityContext.role,
      requestedToolName,
    });

    throw new Error(
      `Tool execution denied by server policy for role ${securityContext.role}.`
    );
  }

  if (
    securityContext.role === "guest" &&
    requestedToolName !== "fetch_live_web_context"
  ) {
    console.error("Blocked guest attempt to execute internal tool.", {
      userId: securityContext.userId,
      requestedToolName,
    });

    throw new Error(GUEST_SECURITY_SYSTEM_INSTRUCTION);
  }
}

async function searchTheWeb(query: string, requestOrigin: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? requestOrigin;
  const normalizedBaseUrl = baseUrl.startsWith("http")
    ? baseUrl
    : `https://${baseUrl}`;

  const response = await fetch(`${normalizedBaseUrl}/api/web-search`, {
    body: JSON.stringify({ query }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
    signal: AbortSignal.timeout(18000),
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readWebSearchError(payload, response.status));
  }

  return stringifyWebSearchPayload(payload);
}

async function executeStaffAccessCommand(
  command: StaffAccessCommand,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  securityContext: SecurityContext
) {
  if (securityContext.role !== "admin") {
    console.error("Unauthorized OUGM staff access command attempt.", {
      userId: securityContext.userId,
      role: securityContext.role,
      action: command.action,
      email: command.email,
    });

    return UNAUTHORIZED_ADMIN_COMMAND_MESSAGE;
  }

  const supabaseAdmin = createSupabaseAdminClient();

  if (command.action === "invite") {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const redirectTo = `${appUrl.replace(/\/$/, "")}/auth/set-password`;

    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      command.email,
      {
        redirectTo,
        data: { role: "staff" },
      }
    );

    if (error) {
      console.error("Failed to generate Supabase staff invitation.", {
        email: command.email,
        error: error.message || error,
      });

      return `Supabase invitation failed for ${command.email}: ${error.message}`;
    }

    return `Invitation successfully generated. Supabase has dispatched a secure authentication token link to ${command.email}.`;
  }

  const authUserId = await resolveAuthUserIdForEmail(command.email, supabase, supabaseAdmin);

  if (authUserId) {
    const { error: authDeleteError } =
      await supabaseAdmin.auth.admin.deleteUser(authUserId);

    if (authDeleteError) {
      console.error("Failed to delete OUGM Auth user.", {
        email: command.email,
        authUserId,
        error: authDeleteError.message || authDeleteError,
      });
      throw new Error(`Failed to delete Auth user: ${authDeleteError.message}`);
    }
  } else {
    console.warn("No Supabase Auth user id found for OUGM staff removal.", {
      email: command.email,
    });
  }

  const { error: inviteDeleteError } = await supabase
    .from("allowed_invites")
    .delete()
    .eq("email", command.email);

  if (inviteDeleteError) {
    console.error("Failed to remove OUGM staff invite.", {
      email: command.email,
      error: inviteDeleteError.message || inviteDeleteError,
    });
    throw new Error(`Failed to remove staff invite: ${inviteDeleteError.message}`);
  }

  const { error: profileDeleteError } = await supabase
    .from("profiles")
    .delete()
    .eq("email", command.email);

  if (profileDeleteError) {
    console.error("Failed to remove OUGM staff profile.", {
      email: command.email,
      error: profileDeleteError.message || profileDeleteError,
    });
    throw new Error(`Failed to remove staff profile: ${profileDeleteError.message}`);
  }

  return `Successfully purged ${command.email} from all OUGM system environments.`;
}

function createSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error("Missing Supabase Auth Admin environment variables.", {
      hasUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey),
    });

    throw new Error("Supabase Auth Admin environment is not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function resolveAuthUserIdForEmail(
  email: string,
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  supabaseAdmin: ReturnType<typeof createSupabaseAdminClient>
) {
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (profileError) {
    console.error("Failed to resolve OUGM profile id for Auth deletion.", {
      email,
      error: profileError.message || profileError,
    });
  }

  if (typeof profile?.id === "string" && isUuid(profile.id)) {
    return profile.id;
  }

  const { data: userPage, error: listUsersError } =
    await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

  if (listUsersError) {
    console.error("Failed to list Supabase Auth users for removal fallback.", {
      email,
      error: listUsersError.message || listUsersError,
    });
    return null;
  }

  const matchingUser = userPage.users.find(
    (user) => normalizeEmail(user.email ?? "") === email
  );

  return matchingUser?.id ?? null;
}

function parseStaffAccessSlashCommand(message: string): StaffAccessCommand | null {
  const trimmedMessage = message.trim();
  const match = /^\/ougm-(invite|remove)-staff\s+([^\s]+)$/i.exec(
    trimmedMessage
  );

  if (!match) {
    return null;
  }

  const action = match[1]?.toLowerCase() === "invite" ? "invite" : "remove";
  const email = normalizeEmail(match[2] ?? "");

  if (!isValidEmail(email)) {
    throw new Error("OUGM staff command requires a valid email address.");
  }

  return { action, email };
}

function parseStaffAccessToolArguments(argumentsJson: string): StaffAccessCommand {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error("Staff management tool arguments were not valid JSON.");
  }

  if (
    !isRecord(parsed) ||
    (parsed.action !== "invite" && parsed.action !== "remove") ||
    typeof parsed.email !== "string"
  ) {
    throw new Error("Staff management tool call requires action and email.");
  }

  const email = normalizeEmail(parsed.email);

  if (!isValidEmail(email)) {
    throw new Error("Staff management tool call requires a valid email address.");
  }

  return {
    action: parsed.action,
    email,
  };
}

function parseWebSearchToolArguments(argumentsJson: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    throw new Error("Web search tool arguments were not valid JSON.");
  }

  if (!isRecord(parsed) || typeof parsed.query !== "string") {
    throw new Error("Web search tool call requires a query string.");
  }

  const query = parsed.query.trim();

  if (!query) {
    throw new Error("Web search tool query cannot be empty.");
  }

  return { query };
}

function stringifyWebSearchPayload(payload: unknown) {
  if (!isRecord(payload)) {
    return "No structured web search payload returned.";
  }

  const data = payload.data;

  if (!isRecord(data)) {
    return JSON.stringify(payload);
  }

  const answer = typeof data.answer === "string" ? data.answer : "";
  const results = Array.isArray(data.results)
    ? data.results
        .slice(0, 5)
        .map((result, index) => {
          if (!isRecord(result)) {
            return null;
          }

          const title = typeof result.title === "string" ? result.title : "";
          const url = typeof result.url === "string" ? result.url : "";
          const content =
            typeof result.content === "string" ? result.content : "";

          return [
            `Result ${index + 1}`,
            title ? `Title: ${title}` : "",
            url ? `URL: ${url}` : "",
            content ? `Snippet: ${content}` : "",
          ]
            .filter(Boolean)
            .join("\n");
        })
        .filter(Boolean)
    : [];

  return [
    "Live web search context:",
    answer ? `Answer: ${answer}` : "",
    ...results,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function readWebSearchError(payload: unknown, status: number) {
  if (isRecord(payload)) {
    if (typeof payload.detail === "string" && payload.detail.length > 0) {
      return payload.detail;
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }
  }

  return `Web search failed with status ${status}.`;
}

async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      console.error("OpenAI request attempt failed.", { attempt, error });

      if (attempt === maxAttempts || !isRetryableError(error)) {
        break;
      }

      await delay(250 * attempt);
    }
  }

  throw lastError;
}

function chatResponse(
  text: string,
  modelActor: ModelActor,
  usedWebSearch = false
) {
  return NextResponse.json({ text, modelActor, usedWebSearch });
}

function startsWithProCommand(message: string) {
  return /^\/PRO\b/i.test(message.trimStart());
}

function stripProCommand(message: string) {
  return message.trimStart().replace(/^\/PRO\b\s*/i, "").trim();
}

function assertOpenAIEnvironment() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("Missing OpenAI API key environment variable.");
    throw new Error("OpenAI API key is not configured.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "staff" || value === "guest";
}

function isToolName(value: string): value is ToolName {
  return (
    value === "fetch_live_web_context" ||
    value === "query_local_db" ||
    value === "manage_staff_access"
  );
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(error: unknown) {
  const status = statusFromError(error);
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

function statusFromError(error: unknown) {
  if (isRecord(error) && typeof error.status === "number") {
    if (error.status >= 400 && error.status < 600) {
      return error.status;
    }
  }

  return 500;
}

function toPublicErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown error.";
}
