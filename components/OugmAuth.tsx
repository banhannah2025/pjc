"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { type FormEvent, useMemo, useState } from "react";

export type UserRole = "admin" | "staff" | "guest";

export type AuthenticatedProfile = {
  user: User;
  role: Exclude<UserRole, "guest">;
};

type OugmAuthProps = {
  onAuthenticated?: (profile: AuthenticatedProfile) => void;
};

const ACCESS_DENIED_MESSAGE =
  "Access Denied. Your account is not authorized to access the internal OUGM operational security hub.";

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export function OugmAuth({ onAuthenticated }: OugmAuthProps) {
  const supabase = useMemo(() => createClient(), []);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const credentials = {
        email: email.trim(),
        password,
      };

      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp(credentials);

        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        setEmail("");
        setPassword("");
        setNotice(
          "Account created. Public registrations grant access to the basic public AI Assistant utility only until an administrator assigns an internal OUGM role."
        );
        return;
      }

      const { data, error: signInError } =
        await supabase.auth.signInWithPassword(credentials);

      if (signInError) {
        setError(signInError.message);
        return;
      }

      if (!data.user) {
        setError("Authentication succeeded, but no user session was returned.");
        return;
      }

      const role = await loadProfileRole(data.user.id, supabase);

      if (role === "guest") {
        await supabase.auth.signOut();
        setError(ACCESS_DENIED_MESSAGE);
        return;
      }

      setEmail("");
      setPassword("");
      onAuthenticated?.({ user: data.user, role });
    } catch (authError) {
      console.error("OUGM authentication failed.", authError);
      setError(
        authError instanceof Error
          ? authError.message
          : "Authentication failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-12 text-slate-100">
      <section className="w-full max-w-md border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40">
        <div className="border-b border-slate-800 px-6 py-5">
          <p className="text-xs font-bold tracking-[0.22em] text-emerald-300">
            OUGM ACCESS CONTROL
          </p>
          <h1 className="mt-3 text-2xl font-bold text-white">
            {isSignUp ? "Public AI Assistant Registration" : "Internal Hub Sign In"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            {isSignUp
              ? "Create a public account for the basic AI Assistant utility. Internal security hub access requires an authorized staff or admin profile role."
              : "Sign in with an authorized staff or admin account to access the internal OUGM operational security hub."}
          </p>
        </div>

        <div className="border-b border-slate-800 bg-slate-950/50 px-6 py-4">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-400">
            {isSignUp ? "Public Registration Mode" : "Secure Hub Verification"}
          </p>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {isSignUp
              ? "Public sign ups are treated as guest access and do not unlock dispatch, team chat, alerts, or security operations."
              : "After password authentication, your profile role is verified before the protected hub layout is released."}
          </p>
        </div>

        <form className="space-y-5 px-6 py-6" onSubmit={handleSubmit}>
          {error && (
            <div
              className="border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium text-red-100"
              role="alert"
            >
              {error}
            </div>
          )}

          {notice && (
            <div
              className="border border-amber-400/40 bg-amber-950/40 px-4 py-3 text-sm font-medium text-amber-100"
              role="status"
            >
              {notice}
            </div>
          )}

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-slate-200"
              htmlFor="ougm-email"
            >
              Email
            </label>
            <input
              autoComplete="email"
              className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
              disabled={loading}
              id="ougm-email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder={
                isSignUp ? "public.user@example.com" : "operator@ougm.local"
              }
              required
              type="email"
              value={email}
            />
          </div>

          <div className="space-y-2">
            <label
              className="text-sm font-semibold text-slate-200"
              htmlFor="ougm-password"
            >
              Password
            </label>
            <input
              autoComplete={isSignUp ? "new-password" : "current-password"}
              className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
              disabled={loading}
              id="ougm-password"
              minLength={6}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter secure password"
              required
              type="password"
              value={password}
            />
          </div>

          <button
            className="flex h-12 w-full items-center justify-center bg-emerald-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            disabled={loading}
            type="submit"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                Processing
              </span>
            ) : isSignUp ? (
              "Create Public AI Account"
            ) : (
              "Verify Internal Access"
            )}
          </button>
        </form>

        <div className="border-t border-slate-800 px-6 py-5">
          <button
            className="w-full text-sm font-semibold text-slate-300 transition hover:text-white disabled:cursor-not-allowed disabled:text-slate-600"
            disabled={loading}
            onClick={() => {
              setError("");
              setNotice("");
              setIsSignUp((value) => !value);
            }}
            type="button"
          >
            {isSignUp
              ? "Already authorized for the hub? Sign in"
              : "Need public AI Assistant access? Create account"}
          </button>
        </div>
      </section>
    </main>
  );
}

async function loadProfileRole(
  userId: string,
  supabase: ReturnType<typeof createClient>
): Promise<UserRole> {
  const { data, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (error) {
    console.error("Failed to load OUGM profile role:", error.message || error);
    return "guest";
  }

  return isUserRole(data?.role) ? data.role : "guest";
}

function isUserRole(value: unknown): value is UserRole {
  return value === "admin" || value === "staff" || value === "guest";
}
