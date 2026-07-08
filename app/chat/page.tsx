"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { ChatInput } from "@/components/ChatInput";
import {
  OugmSecurityPortal,
  type SecurityRoom,
} from "@/components/OugmSecurityPortal";
import { SecurityChatWindow } from "@/components/SecurityChatWindow";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  modelActor?: string;
};

type ChatApiResponse = {
  text?: string;
  modelActor?: string;
  usedWebSearch?: boolean;
  error?: string;
  detail?: string;
};

const sampleChats = [
  "Architecture review",
  "Script runner plan",
  "Research reasoning",
  "General assistant",
];

const triageCards = [
  {
    title: "Fast Triage",
    text: "GPT-4o Mini classifies each request into code, academic, or general routing.",
  },
  {
    title: "Specialist Paths",
    text: "Code commands stay lean while academic and legal-style reasoning move to deeper models.",
  },
  {
    title: "Premium Override",
    text: "Use /PRO or the Pro toggle to bypass routing and send directly to GPT-5.5 Pro.",
  },
];

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchingWeb, setSearchingWeb] = useState(false);
  const [error, setError] = useState("");
  const [activeSecurityRoom, setActiveSecurityRoom] =
    useState<SecurityRoom | null>(null);

  const activeTitle = useMemo(() => {
    const firstUserMessage = messages.find((message) => message.role === "user");
    return firstUserMessage?.text.slice(0, 36) || "New orchestration chat";
  }, [messages]);

  async function handleSendMessage(messageText: string, proToggle: boolean) {
    const trimmedMessage = messageText.trim();

    if (!trimmedMessage || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text: trimmedMessage,
    };

    setMessages((currentMessages) => [...currentMessages, userMessage]);
    setIsLoading(true);
    setSearchingWeb(shouldShowWebSearchIndicator(trimmedMessage));
    setError("");

    try {
      if (startsWithSearchCommand(trimmedMessage)) {
        setSearchingWeb(true);

        const webSearchText = await searchTheWeb(
          stripSearchCommand(trimmedMessage)
        );
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          text: webSearchText || "No web search results were returned.",
          modelActor: "Tavily web search",
        };

        setMessages((currentMessages) => [
          ...currentMessages,
          assistantMessage,
        ]);
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: trimmedMessage,
          proToggle,
        }),
      });

      const payload = (await response.json()) as ChatApiResponse;

      if (!response.ok) {
        throw new Error(
          payload.detail ?? payload.error ?? "The chat request failed."
        );
      }

      const assistantText = payload.text?.trim();

      if (!assistantText) {
        throw new Error("The model returned an empty response.");
      }

      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: assistantText,
        modelActor: payload.usedWebSearch
          ? `${payload.modelActor ?? "unknown"} + web`
          : payload.modelActor ?? "unknown",
      };

      setMessages((currentMessages) => [
        ...currentMessages,
        assistantMessage,
      ]);
    } catch (sendError) {
      console.error("Failed to send chat message.", sendError);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "The chat request failed."
      );
    } finally {
      setIsLoading(false);
      setSearchingWeb(false);
    }
  }

  function startNewChat() {
    setMessages([]);
    setError("");
    setIsLoading(false);
    setSearchingWeb(false);
  }

  return (
    <main className="flex h-dvh overflow-hidden bg-slate-950 text-slate-100">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900 md:flex">
        <div className="border-b border-slate-800 p-4">
          <button
            className="flex min-h-11 w-full items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-4 text-sm font-semibold text-slate-100 transition hover:bg-slate-700"
            onClick={startNewChat}
            type="button"
          >
            + New Chat
          </button>
          <Link
            className="mt-2 flex min-h-11 w-full items-center justify-center rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 hover:bg-emerald-400/20"
            href="/"
          >
            OUGM Security Hub
          </Link>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto p-3">
          {[activeTitle, ...sampleChats].map((title, index) => (
            <button
              className={`w-full truncate rounded-lg px-3 py-3 text-left text-sm transition ${
                index === 0
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
              }`}
              key={`${title}-${index}`}
              type="button"
            >
              {title}
            </button>
          ))}
        </nav>

        <OugmSecurityPortal
          activeRoomId={activeSecurityRoom?.id}
          onRoomSelect={setActiveSecurityRoom}
        />
      </aside>

      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <SecurityChatWindow
          activeRoom={activeSecurityRoom}
          onClose={() => setActiveSecurityRoom(null)}
        />

        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-100">
              Orchestrator Workspace
            </p>
            <p className="truncate text-xs text-slate-500">
              Automated model routing with OpenAI
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-400/20 md:hidden"
              href="/"
            >
              OUGM Hub
            </Link>
            <div className="hidden rounded-full border border-slate-800 px-3 py-1 text-xs font-medium text-slate-400 sm:block">
              Live API
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6 lg:px-10">
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
            {messages.length === 0 ? (
              <EmptyState />
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))
            )}

            {isLoading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-slate-400">
                  {searchingWeb
                    ? "AI is scouring the web for context..."
                    : "Routing request through the model matrix..."}
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-red-500/30 bg-red-950/30 px-4 py-3 text-sm text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-800 bg-slate-950/95 px-3 py-3 shadow-2xl shadow-black/40 sm:px-6 sm:py-4">
          <ChatInput isSubmitting={isLoading} onSend={handleSendMessage} />
        </div>
      </section>
    </main>
  );
}

async function searchTheWeb(query: string) {
  const response = await fetch("/api/web-search", {
    body: JSON.stringify({ query }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(readWebSearchError(payload, response.status));
  }

  return stringifyWebSearchResponse(payload);
}

function shouldShowWebSearchIndicator(message: string) {
  return /\b(web|internet|search|latest|current|today|news|source|sources|bible|world english bible|forgiveness|spiritual|theological|theology)\b/i.test(
    message
  );
}

function startsWithSearchCommand(message: string) {
  return /^\/search\b/i.test(message.trimStart());
}

function stripSearchCommand(message: string) {
  return message.trimStart().replace(/^\/search\b\s*/i, "").trim();
}

function readWebSearchError(payload: unknown, status: number) {
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;

    if (typeof record.detail === "string" && record.detail.length > 0) {
      return record.detail;
    }

    if (typeof record.error === "string" && record.error.length > 0) {
      return record.error;
    }
  }

  return `Web search failed with status ${status}.`;
}

function stringifyWebSearchResponse(payload: unknown) {
  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  return JSON.stringify(record.data ?? record);
}

function EmptyState() {
  return (
    <section className="flex min-h-[55vh] flex-col items-center justify-center text-center">
      <div className="mb-6 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        Model router ready
      </div>
      <h1 className="max-w-2xl text-2xl font-bold text-white sm:text-5xl">
        Start a conversation and let the router choose the right model.
      </h1>
      <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
        The workspace classifies each prompt, dispatches to the right OpenAI
        model, and annotates every assistant response with its model actor.
      </p>

      <div className="mt-8 grid w-full gap-3 sm:mt-10 md:grid-cols-3 md:gap-4">
        {triageCards.map((card) => (
          <article
            className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 text-left sm:p-5"
            key={card.title}
          >
            <h2 className="text-base font-semibold text-slate-100">
              {card.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {card.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-6 shadow-lg sm:max-w-[72%] ${
          isUser
            ? "bg-slate-100 text-slate-950"
            : "border border-slate-800 bg-slate-900 text-slate-100"
        }`}
      >
        {!isUser && message.modelActor && (
          <div className="mb-2 flex">
            <ModelBadge modelActor={message.modelActor} />
          </div>
        )}
        <p className="whitespace-pre-wrap">{message.text}</p>
      </div>
    </div>
  );
}

function ModelBadge({ modelActor }: { modelActor: string }) {
  const classes = modelActor.includes("5.5")
    ? "border-amber-400/40 bg-amber-400/15 text-amber-200"
    : modelActor.includes("5.4")
      ? "border-sky-400/40 bg-sky-400/15 text-sky-200"
      : "border-emerald-400/40 bg-emerald-400/15 text-emerald-200";

  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${classes}`}
    >
      {modelActor}
    </span>
  );
}
