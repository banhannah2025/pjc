"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { OugmAuth, type UserRole } from "@/components/OugmAuth";
import {
  OugmSecurityPortal,
  type SecurityRoom,
} from "@/components/OugmSecurityPortal";
import { SecurityChatWindow } from "@/components/SecurityChatWindow";

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export default function Home() {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<UserRole | null>(null);
  const [activeSecurityRoom, setActiveSecurityRoom] =
    useState<SecurityRoom | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function syncAuthenticatedUser(nextUser: User | null) {
      if (!nextUser) {
        if (isMounted) {
          setUser(null);
          setUserRole(null);
          setActiveSecurityRoom(null);
        }

        return;
      }

      const role = await loadProfileRole(nextUser.id, supabase);

      if (isMounted) {
        setUser(nextUser);
        setUserRole(role);
      }
    }

    async function loadSession() {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (error) {
          console.error("Failed to load Supabase session:", error.message);
        }

        await syncAuthenticatedUser(data.session?.user ?? null);
      } catch (error) {
        console.error(
          "Failed to load Supabase session:",
          error instanceof Error ? error.message : error
        );

        if (isMounted) {
          setUser(null);
        }
      }
    }

    void loadSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void syncAuthenticatedUser(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  if (!user) {
    return (
      <OugmAuth
        onAuthenticated={({ role, user: authenticatedUser }) => {
          setUser(authenticatedUser);
          setUserRole(role);
        }}
      />
    );
  }

  const isAdmin = userRole === "admin";

  return (
    <main className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="flex w-64 shrink-0 flex-col border-r border-slate-800 bg-slate-900">
        <div className="border-b border-slate-800 px-4 py-5">
          <p className="text-xs font-bold tracking-[0.22em] text-emerald-300">
            OUGM
          </p>
          <h1 className="mt-2 text-lg font-bold text-white">
            Security Team Hub
          </h1>
          <p className="mt-1 truncate text-xs text-slate-500">{user.email}</p>
          <span
            className={`mt-3 inline-flex rounded-full border px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
              isAdmin
                ? "border-amber-300/40 bg-amber-300/10 text-amber-200"
                : "border-slate-700 bg-slate-950 text-slate-400"
            }`}
          >
            {isAdmin ? "Admin unrestricted" : "Staff access"}
          </span>
        </div>

        <div className="flex-1 space-y-2 px-4 py-4">
          <button
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-left text-sm font-semibold text-slate-200 transition hover:bg-slate-800"
            onClick={() => setActiveSecurityRoom(null)}
            type="button"
          >
            Security Dashboard
          </button>
          <Link
            className="block w-full rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-left text-sm font-semibold text-emerald-100 transition hover:border-emerald-300/60 hover:bg-emerald-400/20"
            href="/chat"
          >
            AI Chat Workspace
          </Link>
        </div>

        <OugmSecurityPortal
          activeRoomId={activeSecurityRoom?.id}
          onRoomSelect={setActiveSecurityRoom}
        />
      </aside>

      <section className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-16 items-center justify-between border-b border-slate-800 bg-slate-950 px-6">
          <div>
            <p className="text-sm font-bold text-slate-100">
              Security Application Layout
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Select an OUGM channel or direct message to open realtime comms.
            </p>
          </div>
          <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">
            {isAdmin ? "Admin: all modules unlocked" : "Authenticated"}
          </span>
        </div>

        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-lg rounded-lg border border-slate-800 bg-slate-900/70 p-8 text-center shadow-2xl shadow-black/20">
            <p className="text-xs font-bold tracking-[0.2em] text-emerald-300">
              DISPATCH READY
            </p>
            <h2 className="mt-4 text-2xl font-bold text-white">
              OUGM Security Team Hub
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-400">
              Duty alerts, channel routing, media attachments, and realtime
              team messages are available from the secured sidebar.
            </p>
          </div>
        </div>

        <SecurityChatWindow
          activeRoom={activeSecurityRoom}
          onClose={() => setActiveSecurityRoom(null)}
        />
      </section>
    </main>
  );
}

async function loadProfileRole(
  userId: string,
  supabase: ReturnType<typeof createClient>
): Promise<UserRole> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", userId)
      .single();

    if (error) {
      console.error("Failed to load OUGM profile role:", error.message || error);
      return "staff";
    }

    return isUserRole(data?.role) ? data.role : "staff";
  } catch (error) {
    console.error(
      "Failed to load OUGM profile role:",
      error instanceof Error ? error.message : error
    );

    return "staff";
  }
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "staff";
}
