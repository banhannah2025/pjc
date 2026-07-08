import { NextResponse } from "next/server";

export const runtime = "nodejs";

type WebSearchSuccessPayload = {
  data: unknown;
};

type WebSearchErrorPayload = {
  error: string;
  detail?: string;
};

export async function POST(
  req: Request
): Promise<NextResponse<WebSearchSuccessPayload | WebSearchErrorPayload>> {
  try {
    const tavilyApiKey = process.env.TAVILY_API_KEY;

    if (!tavilyApiKey) {
      console.error("Missing Tavily API key environment variable.");

      return NextResponse.json(
        { error: "Tavily API key configuration is missing." },
        { status: 500 }
      );
    }

    const parsedBody = await parseWebSearchRequest(req);

    if (!parsedBody.ok) {
      return NextResponse.json({ error: parsedBody.error }, { status: 400 });
    }

    const response = await fetch("https://api.tavily.com/search", {
      body: JSON.stringify({
        api_key: tavilyApiKey,
        query: parsedBody.query,
        search_depth: "basic",
        include_answer: true,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(15000),
    });

    const payload: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      console.error("Tavily search request failed.", {
        status: response.status,
        payload,
      });

      return NextResponse.json(
        {
          error: "Tavily search request failed.",
          detail: readTavilyError(payload, response.status),
        },
        { status: response.status }
      );
    }

    return NextResponse.json({ data: payload });
  } catch (error) {
    console.error("Web search route failed.", error);

    return NextResponse.json(
      {
        error: "Web search request failed.",
        detail: getErrorMessage(error),
      },
      { status: error instanceof DOMException && error.name === "TimeoutError" ? 504 : 500 }
    );
  }
}

async function parseWebSearchRequest(
  req: Request
): Promise<{ ok: true; query: string } | { ok: false; error: string }> {
  let body: unknown;

  try {
    body = await req.json();
  } catch {
    return { ok: false, error: "Request body must be valid JSON." };
  }

  if (!isRecord(body)) {
    return { ok: false, error: "Request body must be a JSON object." };
  }

  if (typeof body.query !== "string" || body.query.trim().length === 0) {
    return { ok: false, error: "`query` must be a non-empty string." };
  }

  return { ok: true, query: body.query.trim() };
}

function readTavilyError(payload: unknown, status: number) {
  if (isRecord(payload)) {
    if (typeof payload.detail === "string" && payload.detail.length > 0) {
      return payload.detail;
    }

    if (typeof payload.error === "string" && payload.error.length > 0) {
      return payload.error;
    }

    if (typeof payload.message === "string" && payload.message.length > 0) {
      return payload.message;
    }
  }

  return `Tavily returned status ${status}.`;
}

function getErrorMessage(error: unknown) {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "Tavily search request timed out.";
  }

  if (error instanceof Error) {
    return error.message || error.name;
  }

  if (typeof error === "string") {
    return error;
  }

  return "Unknown error.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
