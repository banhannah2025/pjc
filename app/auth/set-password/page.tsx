"use client";

import { createBrowserClient } from "@supabase/ssr";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export default function SetPasswordPage() {
  const supabase = useMemo(() => createClient(), []);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [linkWarning, setLinkWarning] = useState("");
  const [sessionReady, setSessionReady] = useState(false);

  const passwordMeetsLength = newPassword.length >= 8;
  const passwordsMatch =
    confirmPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit = passwordMeetsLength && passwordsMatch && !loading && !success;

  useEffect(() => {
    let isMounted = true;

    async function prepareInviteSession() {
      const linkError = readAuthLinkError();

      if (linkError && isMounted) {
        setLinkWarning(linkError);
      }

      try {
        const code = readAuthCode();

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);

          if (error) {
            throw error;
          }
        }

        const { data, error } = await supabase.auth.getSession();

        if (error) {
          throw error;
        }

        if (isMounted) {
          setSessionReady(Boolean(data.session));

          if (!data.session && !linkError) {
            setLinkWarning(
              "This invitation link is not active. It may have expired, already been used, or been opened in a different browser."
            );
          }
        }
      } catch (error) {
        console.error("Failed to prepare Supabase invite session.", error);

        if (isMounted) {
          setSessionReady(false);
          setLinkWarning(
            error instanceof Error
              ? error.message
              : "This invitation link could not be verified."
          );
        }
      }
    }

    void prepareInviteSession();

    return () => {
      isMounted = false;
    };
  }, [supabase]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    setLoading(true);
    setErrorText("");
    setLinkWarning("");

    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        setLinkWarning(
          isLikelyTokenError(error.message)
            ? error.message
            : "Unable to update password. Confirm the invitation link is still valid and try again."
        );
        return;
      }

      setSuccess(true);
      setNewPassword("");
      setConfirmPassword("");
    } catch (error) {
      console.error("Failed to complete OUGM password setup.", error);
      setErrorText(
        error instanceof Error
          ? error.message
          : "Password setup failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-10 text-slate-100 sm:px-6">
      <section className="w-full max-w-md border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40">
        <div className="border-b border-slate-800 px-5 py-5 sm:px-6">
          <p className="text-xs font-bold tracking-[0.22em] text-emerald-300">
            OUGM ACCESS INITIALIZATION
          </p>
          <h1 className="mt-3 text-2xl font-bold text-white">
            Complete Your OUGM Account Registration
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Create a secure password to finish activating your operational
            account.
          </p>
        </div>

        {success ? (
          <div className="px-5 py-8 text-center sm:px-6">
            <div className="mx-auto flex h-16 w-16 animate-pulse items-center justify-center rounded-full border border-emerald-400/50 bg-emerald-400/10">
              <span className="block h-7 w-4 rotate-45 border-b-4 border-r-4 border-emerald-300" />
            </div>
            <h2 className="mt-5 text-xl font-bold text-white">
              Password Initialized
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              Your account password has been set. Return to access control and
              sign in with your new credentials.
            </p>
            <Link
              className="mt-6 flex min-h-12 w-full items-center justify-center bg-emerald-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-emerald-300"
              href="/"
            >
              Continue to Login
            </Link>
          </div>
        ) : (
          <form className="space-y-5 px-5 py-6 sm:px-6" onSubmit={handleSubmit}>
            {linkWarning && (
              <div
                className="border border-amber-400/40 bg-amber-950/40 px-4 py-3 text-sm font-medium leading-6 text-amber-100"
                role="alert"
              >
                {linkWarning}
              </div>
            )}

            {errorText && (
              <div
                className="border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium text-red-100"
                role="alert"
              >
                {errorText}
              </div>
            )}

            <div className="space-y-2">
              <label
                className="text-sm font-semibold text-slate-200"
                htmlFor="ougm-new-password"
              >
                New Password
              </label>
              <input
                autoComplete="new-password"
                className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
                disabled={loading}
                id="ougm-new-password"
                minLength={8}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={newPassword}
              />
              <p
                className={`text-xs ${
                  passwordMeetsLength ? "text-emerald-300" : "text-slate-500"
                }`}
              >
                Minimum 8 characters required.
              </p>
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-semibold text-slate-200"
                htmlFor="ougm-confirm-password"
              >
                Confirm Password
              </label>
              <input
                autoComplete="new-password"
                className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-emerald-400"
                disabled={loading}
                id="ougm-confirm-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                required
                type="password"
                value={confirmPassword}
              />
              <p
                className={`text-xs ${
                  passwordsMatch ? "text-emerald-300" : "text-slate-500"
                }`}
              >
                Passwords must match exactly.
              </p>
            </div>

            <button
              className="flex min-h-12 w-full items-center justify-center bg-emerald-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
              disabled={!canSubmit || !sessionReady}
              type="submit"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
                  Updating Password
                </span>
              ) : (
                "Complete Registration"
              )}
            </button>

            {!sessionReady && (
              <p className="text-center text-xs leading-5 text-slate-500">
                Waiting for a valid Supabase invitation session.
              </p>
            )}
          </form>
        )}
      </section>
    </main>
  );
}

function readAuthCode() {
  if (typeof window === "undefined") {
    return "";
  }

  const searchParams = new URLSearchParams(window.location.search);
  return searchParams.get("code") ?? "";
}

function readAuthLinkError() {
  if (typeof window === "undefined") {
    return "";
  }

  const searchParams = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));

  return (
    searchParams.get("error_description") ??
    hashParams.get("error_description") ??
    searchParams.get("error") ??
    hashParams.get("error") ??
    ""
  );
}

function isLikelyTokenError(message: string) {
  return /\b(expired|invalid|token|session|link|otp)\b/i.test(message);
}
