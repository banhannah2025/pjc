"use client";

import { createBrowserClient } from "@supabase/ssr";
import Image from "next/image";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { SecurityRoom } from "@/components/OugmSecurityPortal";

type SecurityMessage = {
  id: string;
  room_id: string;
  sender_id?: string | null;
  sender_name?: string | null;
  text?: string | null;
  image_url?: string | null;
  created_at?: string | null;
};

type SecurityChatWindowProps = {
  activeRoom: SecurityRoom | null;
  onClose: () => void;
};

type SendSecurityMessageResponse = {
  message?: SecurityMessage;
  error?: string;
  detail?: string;
};

type LoadSecurityMessagesResponse = {
  messages?: SecurityMessage[];
  error?: string;
  detail?: string;
};

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export function SecurityChatWindow({
  activeRoom,
  onClose,
}: SecurityChatWindowProps) {
  const supabase = useMemo(() => createClient(), []);
  const [messages, setMessages] = useState<SecurityMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeRoom) {
      return;
    }

    const room = activeRoom;
    let isMounted = true;

    async function loadRoomMessages() {
      const activeRoomId = room.id;

      if (!isUuid(activeRoomId)) {
        console.warn(
          "Skipping security room message load because room_id is not a UUID:",
          activeRoomId
        );

        if (isMounted) {
          setMessages([]);
        }

        return;
      }

      try {
        const response = await fetch(
          `/api/security/messages?roomId=${encodeURIComponent(activeRoomId)}`,
          {
            cache: "no-store",
            method: "GET",
          }
        );
        const payload = (await response.json().catch(() => ({}))) as
          | LoadSecurityMessagesResponse
          | undefined;

        if (!response.ok) {
          throw new Error(
            payload?.detail ??
              payload?.error ??
              "Unable to load security messages."
          );
        }

        if (isMounted) {
          setMessages(
            Array.isArray(payload?.messages) ? payload.messages : []
          );
        }
      } catch (loadError) {
        const safeLoadError = loadError as { message?: string };

        console.error(
          "Failed to load security room messages:",
          safeLoadError.message || loadError
        );

        if (isMounted) {
          setMessages([]);
          setError("Unable to load security messages.");
        }
      }
    }

    void loadRoomMessages();

    if (!isUuid(room.id)) {
      return () => {
        isMounted = false;
      };
    }

    const channel = supabase
      .channel(`security-room-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "security_messages",
          filter: `room_id=eq.${room.id}`,
        },
        (payload) => {
          const nextMessage = payload.new as SecurityMessage;
          setMessages((currentMessages) => {
            if (
              currentMessages.some((message) => message.id === nextMessage.id)
            ) {
              return currentMessages;
            }

            return [...currentMessages, nextMessage];
          });
        }
      )
      .subscribe((status, subscribeError) => {
        if (subscribeError) {
          console.error("Security Realtime subscription failed.", {
            status,
            subscribeError,
          });
        }
      });

    return () => {
      isMounted = false;
      void supabase.removeChannel(channel);
    };
  }, [activeRoom, supabase]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, activeRoom]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!activeRoom || isSending) {
      return;
    }

    const text = draft.trim();

    if (!text && !selectedImage) {
      return;
    }

    setIsSending(true);
    setError("");

    try {
      const imageUrl = selectedImage
        ? await uploadAttachment(selectedImage, activeRoom.id, supabase)
        : null;

      const response = await fetch("/api/security/messages", {
        body: JSON.stringify({
          roomId: activeRoom.id,
          text,
          imageUrl,
        }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => ({}))) as
        | SendSecurityMessageResponse
        | undefined;

      if (!response.ok) {
        throw new Error(
          payload?.detail ??
            payload?.error ??
            "Unable to send security message."
        );
      }

      const sentMessage = payload?.message;

      if (sentMessage) {
        setMessages((currentMessages) => {
          if (currentMessages.some((message) => message.id === sentMessage.id)) {
            return currentMessages;
          }

          return [...currentMessages, sentMessage];
        });
      }

      setDraft("");
      setSelectedImage(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    } catch (sendError) {
      console.error("Failed to send OUGM security message.", sendError);
      setError(
        sendError instanceof Error
          ? sendError.message
          : "Unable to send security message."
      );
    } finally {
      setIsSending(false);
    }
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;

    if (file && !file.type.startsWith("image/")) {
      setError("Only image attachments are supported.");
      event.target.value = "";
      return;
    }

    setError("");
    setSelectedImage(file);
  }

  if (!activeRoom) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-30 flex bg-slate-950 text-slate-100">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-100">
              {activeRoom.label}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              OUGM Realtime Security Dispatch
            </p>
          </div>
          <button
            className="min-h-10 shrink-0 rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:bg-slate-800"
            onClick={onClose}
            type="button"
          >
            Close
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          <div className="mx-auto flex max-w-4xl flex-col gap-4">
            {messages.length === 0 ? (
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-6 text-center">
                <p className="text-base font-semibold text-slate-100">
                  No dispatch messages yet.
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Send a message or attach an image to start this room.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <article
                  className="rounded-xl border border-slate-800 bg-slate-900/80 p-3 sm:p-4"
                  key={message.id}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-slate-200">
                      {message.sender_name ?? "Security Operator"}
                    </p>
                    <time className="shrink-0 text-xs text-slate-600">
                      {formatTimestamp(message.created_at)}
                    </time>
                  </div>
                  {message.text && (
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-300">
                      {message.text}
                    </p>
                  )}
                  {isValidImageUrl(message.image_url) && (
                    <a
                      className="mt-3 block overflow-hidden rounded-lg border border-slate-700 bg-slate-950"
                      href={message.image_url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Image
                        alt="OUGM security attachment"
                        className="h-auto w-full object-cover"
                        height={360}
                        src={message.image_url}
                        unoptimized
                        width={640}
                      />
                    </a>
                  )}
                </article>
              ))
            )}
            <div ref={scrollRef} />
          </div>
        </div>

        <form
          className="border-t border-slate-800 bg-slate-900 px-4 py-3 sm:px-5 sm:py-4"
          onSubmit={handleSubmit}
        >
          {error && (
            <div className="mb-3 rounded-lg border border-red-500/30 bg-red-950/40 px-3 py-2 text-sm text-red-200">
              {error}
            </div>
          )}

          {selectedImage && (
            <div className="mb-3 flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300">
              <span className="truncate">{selectedImage.name}</span>
              <button
                className="text-slate-500 transition hover:text-slate-200"
                onClick={() => setSelectedImage(null)}
                type="button"
              >
                Remove
              </button>
            </div>
          )}

          <div className="grid grid-cols-[44px_1fr] items-end gap-3 sm:flex">
            <input
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
              ref={fileInputRef}
              type="file"
            />
            <button
              aria-label="Attach image"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-lg text-slate-300 transition hover:bg-slate-800"
              onClick={() => fileInputRef.current?.click()}
              type="button"
            >
              +
            </button>
            <textarea
              className="min-h-11 min-w-0 resize-none rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-slate-500 sm:flex-1"
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Message security team..."
              value={draft}
            />
            <button
              className="col-span-2 min-h-11 rounded-lg bg-emerald-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 sm:col-span-1"
              disabled={isSending || (!draft.trim() && !selectedImage)}
              type="submit"
            >
              {isSending ? "Sending" : "Send"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

async function uploadAttachment(
  file: File,
  roomId: string,
  supabase: ReturnType<typeof createClient>
) {
  const extension = file.name.split(".").pop() ?? "jpg";
  const path = `${roomId}/${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("ougm-security-media")
    .upload(path, file, {
      cacheControl: "3600",
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage
    .from("ougm-security-media")
    .getPublicUrl(path);

  return data.publicUrl;
}

function isValidImageUrl(value: string | null | undefined): value is string {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function formatTimestamp(value: string | null | undefined) {
  if (!value) {
    return "now";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}
