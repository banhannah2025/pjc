"use client";

import { createBrowserClient } from "@supabase/ssr";
import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

export type SecurityRoom = {
  id: string;
  label: string;
  type: "channel" | "dm";
};

type RoomType = "group" | "dm";

type ChatRoom = {
  id: string;
  name: string;
  is_group: boolean;
};

type OugmSecurityPortalProps = {
  activeRoomId?: string;
  onRoomSelect?: (room: SecurityRoom) => void;
};

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export function OugmSecurityPortal({
  activeRoomId,
  onRoomSelect,
}: OugmSecurityPortalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [isAlertsActive, setIsAlertsActive] = useState(false);
  const [isSavingAlerts, setIsSavingAlerts] = useState(false);
  const [channels, setChannels] = useState<ChatRoom[]>([]);
  const [directMessages, setDirectMessages] = useState<ChatRoom[]>([]);
  const [statusText, setStatusText] = useState("");
  const [directoryStatus, setDirectoryStatus] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [roomType, setRoomType] = useState<RoomType>("group");
  const [newRoomName, setNewRoomName] = useState("");
  const [targetUserEmail, setTargetUserEmail] = useState("");
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [modalError, setModalError] = useState("");
  const [roomRefreshKey, setRoomRefreshKey] = useState(0);

  useEffect(() => {
    let isMounted = true;

    async function loadRooms() {
      const result = await fetchChatRooms(supabase);

      if (!isMounted) {
        return;
      }

      setChannels(result.channels);
      setDirectMessages(result.directMessages);
      setDirectoryStatus(result.status);
    }

    void loadRooms();

    return () => {
      isMounted = false;
    };
  }, [supabase, roomRefreshKey]);

  useEffect(() => {
    let isMounted = true;

    async function loadAlertState() {
      try {
        const response = await fetch("/api/security/alerts", {
          method: "GET",
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => null);
          throw new Error(readAlertRouteError(payload, response.status));
        }

        const payload: unknown = await response.json();

        if (!isMounted) {
          return;
        }

        if (isAlertStatePayload(payload)) {
          setIsAlertsActive(payload.isAlertsActive);
          setStatusText(
            payload.isAlertsActive ? "Active alerts restored" : "Alerts muted"
          );
        }
      } catch (error) {
        console.error(
          "Failed to load OUGM active alert state:",
          getErrorMessage(error)
        );

        if (isMounted) {
          setStatusText("Alert status unavailable");
        }
      }
    }

    void loadAlertState();

    return () => {
      isMounted = false;
    };
  }, []);

  function openCreateRoomModal(nextRoomType: RoomType) {
    setRoomType(nextRoomType);
    setNewRoomName("");
    setTargetUserEmail("");
    setModalError("");
    setIsModalOpen(true);
  }

  function closeCreateRoomModal() {
    if (isCreatingRoom) {
      return;
    }

    setIsModalOpen(false);
    setModalError("");
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsCreatingRoom(true);
    setModalError("");

    const roomName =
      roomType === "group"
        ? newRoomName.trim()
        : targetUserEmail.trim().toLowerCase();

    if (!roomName) {
      setModalError(
        roomType === "group"
          ? "Room name is required."
          : "Target user email is required."
      );
      setIsCreatingRoom(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("chat_rooms")
        .insert([{ name: roomName, is_group: roomType === "group" }])
        .select("id, name, is_group")
        .single();

      if (error) {
        throw error;
      }

      if (!isChatRoom(data)) {
        throw new Error("Created room payload was not returned in the expected shape.");
      }

      onRoomSelect?.({
        id: data.id,
        label: formatRoomLabel(data),
        type: data.is_group ? "channel" : "dm",
      });

      setNewRoomName("");
      setTargetUserEmail("");
      setIsModalOpen(false);
      setDirectoryStatus("");
      setRoomRefreshKey((currentKey) => currentKey + 1);
    } catch (error) {
      console.error(
        "Failed to create OUGM chat room:",
        error instanceof Error ? error.message : error
      );
      setModalError("Unable to create room. Check permissions and try again.");
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function handleAlertsToggle(nextAlertsActive: boolean) {
    setIsSavingAlerts(true);
    setStatusText("");
    setIsAlertsActive(nextAlertsActive);

    try {
      let notificationToken: string | null = null;

      if (nextAlertsActive) {
        notificationToken = await createPushSubscriptionToken();
      }

      const response = await fetch("/api/security/alerts", {
        body: JSON.stringify({
          isAlertsActive: nextAlertsActive,
          notificationToken,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(readAlertRouteError(payload, response.status));
      }

      setStatusText(nextAlertsActive ? "Active alerts enabled" : "Alerts muted");
    } catch (error) {
      const errorMessage = getErrorMessage(error);

      console.error("Failed to update OUGM active alerts:", errorMessage);
      setIsAlertsActive(!nextAlertsActive);
      setStatusText(`Alert update failed: ${errorMessage}`);
    } finally {
      setIsSavingAlerts(false);
    }
  }

  return (
    <section className="border-t border-slate-800 bg-slate-900 p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-emerald-300">
            OUGM SECURITY
          </p>
          <p className="mt-1 text-xs text-slate-500">Team hub and dispatch</p>
        </div>
        <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-200">
          LIVE
        </span>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">
              Active Alerts
            </p>
            <p className="mt-1 text-xs text-slate-500">
              {statusText || "Native push dispatch control"}
            </p>
          </div>
          <button
            aria-checked={isAlertsActive}
            aria-label="Toggle active OUGM alerts"
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${
              isAlertsActive
                ? "bg-amber-600 shadow-lg shadow-amber-600/30"
                : "bg-slate-700"
            } ${isSavingAlerts ? "opacity-60" : ""}`}
            disabled={isSavingAlerts}
            onClick={() => void handleAlertsToggle(!isAlertsActive)}
            role="switch"
            type="button"
          >
            <span
              className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                isAlertsActive ? "translate-x-5" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      <nav className="mt-4 space-y-4">
        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Channels
            </p>
            <button
              aria-label="Create group channel"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-sm font-bold text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-200"
              onClick={() => openCreateRoomModal("group")}
              type="button"
            >
              +
            </button>
          </div>
          <div className="space-y-1">
            {directoryStatus ? (
              <p className="rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                {directoryStatus}
              </p>
            ) : channels.length === 0 ? (
              <p className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-500">
                No group channels found
              </p>
            ) : (
              channels.map((channel) => (
                <RoomButton
                  activeRoomId={activeRoomId}
                  key={channel.id}
                  onRoomSelect={onRoomSelect}
                  room={channel}
                />
              ))
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Direct Messages
            </p>
            <button
              aria-label="Create direct message room"
              className="flex h-6 w-6 items-center justify-center rounded-md border border-slate-700 bg-slate-950 text-sm font-bold text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-200"
              onClick={() => openCreateRoomModal("dm")}
              type="button"
            >
              +
            </button>
          </div>
          <div className="space-y-1">
            {directMessages.length === 0 ? (
              <p className="rounded-md border border-slate-800 px-3 py-2 text-xs text-slate-500">
                No direct messages found
              </p>
            ) : (
              directMessages.map((room) => (
                <RoomButton
                  activeRoomId={activeRoomId}
                  key={room.id}
                  onRoomSelect={onRoomSelect}
                  room={room}
                />
              ))
            )}
          </div>
        </div>
      </nav>

      {isModalOpen && (
        <div
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm"
          role="dialog"
        >
          <form
            className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-5 shadow-2xl shadow-black/50"
            onSubmit={handleCreateRoom}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold tracking-[0.18em] text-emerald-300">
                  {roomType === "group" ? "NEW CHANNEL" : "NEW DIRECT MESSAGE"}
                </p>
                <h2 className="mt-2 text-lg font-bold text-white">
                  {roomType === "group"
                    ? "Create Group Channel"
                    : "Create DM Room"}
                </h2>
              </div>
              <button
                aria-label="Close room creation modal"
                className="rounded-md border border-slate-700 px-2 py-1 text-xs font-bold text-slate-400 transition hover:bg-slate-800 hover:text-white"
                onClick={closeCreateRoomModal}
                type="button"
              >
                X
              </button>
            </div>

            <label
              className="mt-5 block text-sm font-semibold text-slate-200"
              htmlFor="ougm-room-input"
            >
              {roomType === "group" ? "Room Name" : "Target User Email"}
            </label>
            <input
              autoComplete={roomType === "dm" ? "email" : "off"}
              className="mt-2 h-11 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
              disabled={isCreatingRoom}
              id="ougm-room-input"
              onChange={(event) =>
                roomType === "group"
                  ? setNewRoomName(event.target.value)
                  : setTargetUserEmail(event.target.value)
              }
              placeholder={
                roomType === "group" ? "channel-name" : "operator@ougm.local"
              }
              type={roomType === "dm" ? "email" : "text"}
              value={roomType === "group" ? newRoomName : targetUserEmail}
            />

            {modalError && (
              <p className="mt-3 rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                {modalError}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-slate-800"
                disabled={isCreatingRoom}
                onClick={closeCreateRoomModal}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
                disabled={isCreatingRoom}
                type="submit"
              >
                {isCreatingRoom ? "Creating" : "Create"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function RoomButton({
  activeRoomId,
  onRoomSelect,
  room,
}: {
  activeRoomId?: string;
  onRoomSelect?: (room: SecurityRoom) => void;
  room: ChatRoom;
}) {
  const securityRoom: SecurityRoom = {
    id: room.id,
    label: formatRoomLabel(room),
    type: room.is_group ? "channel" : "dm",
  };

  return (
    <button
      className={`w-full truncate rounded-md px-3 py-2 text-left text-xs transition ${
        activeRoomId === room.id
          ? "bg-slate-800 text-white"
          : "text-slate-400 hover:bg-slate-800/70 hover:text-slate-100"
      }`}
      onClick={() => onRoomSelect?.(securityRoom)}
      type="button"
    >
      {securityRoom.label}
    </button>
  );
}

async function fetchChatRooms(supabase: ReturnType<typeof createClient>) {
  try {
    const { data: channelRows, error: channelError } = await supabase
      .from("chat_rooms")
      .select("id, name, is_group")
      .eq("is_group", true)
      .order("name", { ascending: true });

    if (channelError) {
      console.error(
        "Failed to load OUGM security channels:",
        channelError.message || channelError
      );
      return {
        channels: [],
        directMessages: [],
        status: "Room directory unavailable",
      };
    }

    const { data: directMessageRows, error: directMessageError } =
      await supabase
        .from("chat_rooms")
        .select("id, name, is_group")
        .eq("is_group", false)
        .order("name", { ascending: true });

    if (directMessageError) {
      console.error(
        "Failed to load OUGM direct message rooms:",
        directMessageError.message || directMessageError
      );
      return {
        channels: uniqueRooms(Array.isArray(channelRows) ? channelRows : []),
        directMessages: [],
        status: "Direct message directory unavailable",
      };
    }

    return {
      channels: uniqueRooms(Array.isArray(channelRows) ? channelRows : []),
      directMessages: uniqueRooms(
        Array.isArray(directMessageRows) ? directMessageRows : []
      ),
      status: "",
    };
  } catch (error) {
    console.error(
      "Failed to load OUGM chat rooms:",
      error instanceof Error ? error.message : error
    );

    return {
      channels: [],
      directMessages: [],
      status: "Room directory unavailable",
    };
  }
}

async function createPushSubscriptionToken() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    throw new Error("Push notifications are not supported in this browser.");
  }

  if (!("Notification" in window)) {
    throw new Error("Notifications are not supported in this browser.");
  }

  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

  if (!vapidPublicKey) {
    throw new Error("Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.");
  }

  const permission = await Notification.requestPermission();

  if (permission !== "granted") {
    throw new Error("Notification permission was not granted.");
  }

  const registration = await navigator.serviceWorker.register("/sw.js");
  const existingSubscription =
    await registration.pushManager.getSubscription();

  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
    }));

  return JSON.stringify(subscription.toJSON());
}

function isChatRoom(value: unknown): value is ChatRoom {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.id === "string" &&
    isUuid(record.id) &&
    typeof record.name === "string" &&
    record.name.trim().length > 0 &&
    typeof record.is_group === "boolean"
  );
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

function formatRoomLabel(room: ChatRoom) {
  const trimmedName = room.name.trim();

  if (room.is_group) {
    return trimmedName.startsWith("#") ? trimmedName : `# ${trimmedName}`;
  }

  return trimmedName.startsWith("@") ? trimmedName : `@ ${trimmedName}`;
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

  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;

    if (typeof record.message === "string" && record.message.length > 0) {
      return record.message;
    }

    if (typeof record.error_description === "string") {
      return record.error_description;
    }

    if (typeof record.error === "string") {
      return record.error;
    }

    const serialized = JSON.stringify(record);
    return serialized === "{}" ? "Unknown browser or Supabase error" : serialized;
  }

  return "Unknown browser or Supabase error";
}

function readAlertRouteError(payload: unknown, status: number) {
  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>;

    if (typeof record.detail === "string" && record.detail.length > 0) {
      return record.detail;
    }

    if (typeof record.error === "string" && record.error.length > 0) {
      return record.error;
    }
  }

  return `Alert update request failed with status ${status}.`;
}

function isAlertStatePayload(
  value: unknown
): value is { isAlertsActive: boolean } {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;
  return typeof record.isAlertsActive === "boolean";
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}
