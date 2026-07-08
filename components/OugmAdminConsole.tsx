"use client";

import { createBrowserClient } from "@supabase/ssr";
import { type FormEvent, useEffect, useMemo, useState } from "react";

type UserRole = "admin" | "staff" | "guest";
type InviteRole = "staff" | "admin";

type AllowedInvite = {
  email: string;
  assigned_role: InviteRole;
};

type OugmAdminConsoleProps = {
  userRole?: UserRole | null;
};

function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Missing public Supabase browser environment.");
  }

  return createBrowserClient(supabaseUrl, supabaseKey);
}

export function OugmAdminConsole({ userRole }: OugmAdminConsoleProps) {
  const supabase = useMemo(() => createClient(), []);
  const [targetEmail, setTargetEmail] = useState("");
  const [selectedRole, setSelectedRole] = useState<InviteRole>("staff");
  const [invites, setInvites] = useState<AllowedInvite[]>([]);
  const [loadingInvites, setLoadingInvites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("");
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (userRole !== "admin") {
      return;
    }

    let isMounted = true;

    async function loadInvites() {
      setLoadingInvites(true);
      setErrorText("");

      const result = await fetchAllowedInvites(supabase);

      if (!isMounted) {
        return;
      }

      if (result.error) {
        setErrorText(result.error);
        setInvites([]);
      } else {
        setInvites(result.invites);
      }

      setLoadingInvites(false);
    }

    void loadInvites();

    return () => {
      isMounted = false;
    };
  }, [supabase, userRole]);

  if (userRole !== "admin") {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setStatusText("");
    setErrorText("");

    const normalizedEmail = targetEmail.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      setErrorText("Enter a valid invite email address.");
      setSubmitting(false);
      return;
    }

    try {
      const { error } = await supabase
        .from("allowed_invites")
        .insert([{ email: normalizedEmail, assigned_role: selectedRole }]);

      if (error) {
        throw error;
      }

      const result = await fetchAllowedInvites(supabase);

      if (result.error) {
        setErrorText(result.error);
      } else {
        setInvites(result.invites);
        setTargetEmail("");
        setSelectedRole("staff");
        setStatusText(`Invite registered for ${normalizedEmail}.`);
      }
    } catch (error) {
      const message = getErrorMessage(error);

      console.error("Failed to create OUGM allowed invite:", message);
      setErrorText(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="border-t border-slate-800 bg-slate-900 p-4 text-slate-100">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold tracking-[0.18em] text-amber-300">
            ADMIN CONSOLE
          </p>
          <h2 className="mt-2 text-lg font-bold text-white">
            Invitation Registry
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Add approved staff and admin emails before account registration.
          </p>
        </div>
        <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-200">
          ADMIN
        </span>
      </div>

      <form
        className="rounded-lg border border-slate-800 bg-slate-950/60 p-3"
        onSubmit={handleSubmit}
      >
        <label
          className="block text-xs font-semibold uppercase tracking-wide text-slate-400"
          htmlFor="ougm-admin-invite-email"
        >
          Invite Email
        </label>
        <input
          autoComplete="email"
          className="mt-2 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-400"
          disabled={submitting}
          id="ougm-admin-invite-email"
          onChange={(event) => setTargetEmail(event.target.value)}
          placeholder="operator@example.com"
          required
          type="email"
          value={targetEmail}
        />

        <label
          className="mt-3 block text-xs font-semibold uppercase tracking-wide text-slate-400"
          htmlFor="ougm-admin-invite-role"
        >
          Target Role
        </label>
        <select
          className="mt-2 h-10 w-full rounded-md border border-slate-700 bg-slate-950 px-3 text-sm font-semibold text-slate-100 outline-none transition focus:border-amber-400"
          disabled={submitting}
          id="ougm-admin-invite-role"
          onChange={(event) =>
            setSelectedRole(event.target.value === "admin" ? "admin" : "staff")
          }
          value={selectedRole}
        >
          <option value="staff">Staff</option>
          <option value="admin">Admin</option>
        </select>

        <button
          className="mt-4 flex h-10 w-full items-center justify-center rounded-md bg-amber-400 px-3 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          disabled={submitting}
          type="submit"
        >
          {submitting ? "Registering Invite" : "Add Invite"}
        </button>
      </form>

      {errorText && (
        <p
          className="mt-3 rounded-md border border-red-500/30 bg-red-950/40 px-3 py-2 text-xs font-medium text-red-200"
          role="alert"
        >
          {errorText}
        </p>
      )}

      {statusText && (
        <p
          className="mt-3 rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-medium text-emerald-200"
          role="status"
        >
          {statusText}
        </p>
      )}

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Waiting To Register
          </p>
          <span className="text-[11px] font-semibold text-slate-500">
            {loadingInvites ? "Refreshing" : `${invites.length} pending`}
          </span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-800">
          <table className="w-full table-fixed border-collapse text-left text-xs">
            <thead className="bg-slate-950 text-slate-500">
              <tr>
                <th className="border-b border-slate-800 px-3 py-2 font-semibold">
                  Email
                </th>
                <th className="w-24 border-b border-slate-800 px-3 py-2 font-semibold">
                  Role
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 bg-slate-900">
              {invites.length === 0 ? (
                <tr>
                  <td
                    className="px-3 py-4 text-center text-slate-500"
                    colSpan={2}
                  >
                    {loadingInvites ? "Loading invites" : "No pending invites"}
                  </td>
                </tr>
              ) : (
                invites.map((invite, index) => (
                  <tr key={`${invite.email}-${invite.assigned_role}-${index}`}>
                    <td className="truncate px-3 py-2 text-slate-200">
                      {invite.email}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${
                          invite.assigned_role === "admin"
                            ? "bg-amber-400/15 text-amber-200"
                            : "bg-emerald-400/10 text-emerald-200"
                        }`}
                      >
                        {invite.assigned_role}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

async function fetchAllowedInvites(supabase: ReturnType<typeof createClient>) {
  try {
    const { data, error } = await supabase
      .from("allowed_invites")
      .select("email, assigned_role");

    if (error) {
      throw error;
    }

    return {
      error: "",
      invites: Array.isArray(data) ? data.filter(isAllowedInvite) : [],
    };
  } catch (error) {
    const message = getErrorMessage(error);

    console.error("Failed to load OUGM allowed invites:", message);

    return {
      error: message,
      invites: [],
    };
  }
}

function isAllowedInvite(value: unknown): value is AllowedInvite {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const record = value as Record<string, unknown>;

  return (
    typeof record.email === "string" &&
    isValidEmail(record.email) &&
    (record.assigned_role === "staff" || record.assigned_role === "admin")
  );
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
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
    return serialized === "{}" ? "Unknown Supabase error" : serialized;
  }

  return "Unknown Supabase error";
}
