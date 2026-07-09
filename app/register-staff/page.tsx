"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type Step = 1 | 2;

type ValidateInviteResponse = {
  authorized?: boolean;
  firstName?: string | null;
  lastName?: string | null;
  error?: string;
};

type CreateStaffAccountResponse = {
  ok?: boolean;
  error?: string;
};

export default function RegisterStaffPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savedFirstName, setSavedFirstName] = useState("");
  const [savedLastName, setSavedLastName] = useState("");
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const normalizedEmail = email.trim().toLowerCase();
  const passwordReady = password.length >= 8 && password === confirmPassword;

  async function handleWhitelistSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/register-staff/validate-invite", {
        body: JSON.stringify({ email: normalizedEmail }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | ValidateInviteResponse
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to validate staff invite.");
        return;
      }

      if (!payload?.authorized) {
        setError(
          "This email address has not been pre-authorized by an administrator."
        );
        return;
      }

      setEmail(normalizedEmail);
      setSavedFirstName(payload.firstName?.trim() ?? "");
      setSavedLastName(payload.lastName?.trim() ?? "");
      setStep(2);
    } catch (validationError) {
      console.error("Failed to validate OUGM staff invite.", validationError);
      setError(
        "This email address has not been pre-authorized by an administrator."
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");

    if (!passwordReady) {
      setError("Password must be at least 8 characters and match exactly.");
      setLoading(false);
      return;
    }

    try {
      const response = await fetch("/api/register-staff/create-account", {
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          firstName: savedFirstName,
          lastName: savedLastName,
        }),
        headers: {
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | CreateStaffAccountResponse
        | null;

      if (!response.ok || !payload?.ok) {
        setError(
          payload?.error ?? "Account initialization failed. Please try again."
        );
        return;
      }

      setSuccess(true);
      window.setTimeout(() => router.push("/"), 1400);
    } catch (registrationError) {
      console.error("Failed to initialize OUGM staff account.", registrationError);
      setError(
        registrationError instanceof Error
          ? registrationError.message
          : "Account initialization failed. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 px-4 py-10 text-slate-100 sm:px-6">
      <section className="w-full max-w-md border border-slate-800 bg-slate-900 shadow-2xl shadow-black/40">
        <div className="border-b border-slate-800 bg-slate-950/50 px-5 py-5 sm:px-6">
          <p className="text-xs font-bold tracking-[0.22em] text-amber-300">
            OUGM STAFF PROVISIONING
          </p>
          <h1 className="mt-3 text-2xl font-bold text-white">
            Initialize Internal Staff Credentials
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">
            Validate your administrator-approved email, then create your secure
            access profile.
          </p>
        </div>

        <div className="border-b border-slate-800 px-5 py-4 sm:px-6">
          <div className="grid grid-cols-2 gap-2 text-xs font-bold uppercase tracking-wide">
            <div
              className={`border px-3 py-2 ${
                step === 1
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                  : "border-slate-800 text-slate-500"
              }`}
            >
              01 Whitelist
            </div>
            <div
              className={`border px-3 py-2 ${
                step === 2
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-200"
                  : "border-slate-800 text-slate-500"
              }`}
            >
              02 Password
            </div>
          </div>
        </div>

        {success ? (
          <div
            className="border border-emerald-400/30 bg-emerald-400/10 px-5 py-6 text-center text-sm font-semibold text-emerald-100 sm:px-6"
            role="status"
          >
            Account Created Successfully! Redirecting to login...
          </div>
        ) : step === 1 ? (
          <form
            className="space-y-5 px-5 py-6 sm:px-6"
            onSubmit={handleWhitelistSubmit}
          >
            {error && <ErrorBanner message={error} />}

            <div className="space-y-2">
              <label
                className="text-sm font-semibold text-slate-200"
                htmlFor="ougm-invited-email"
              >
                Invited Email Address
              </label>
              <input
                autoComplete="email"
                className="h-12 w-full border border-slate-700 bg-slate-950 px-3 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-400"
                disabled={loading}
                id="ougm-invited-email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="operator@example.com"
                required
                type="email"
                value={email}
              />
            </div>

            <button
              className="flex min-h-12 w-full items-center justify-center border border-amber-400 bg-amber-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-400"
              disabled={loading || normalizedEmail.length === 0}
              type="submit"
            >
              {loading ? "Validating" : "Validate Whitelist"}
            </button>
          </form>
        ) : (
          <form
            className="space-y-5 px-5 py-6 sm:px-6"
            onSubmit={handleAccountSubmit}
          >
            {error && <ErrorBanner message={error} />}

            <div className="border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-400">
              Authorized email:{" "}
              <span className="text-amber-200">{normalizedEmail}</span>
              {(savedFirstName || savedLastName) && (
                <span className="mt-1 block text-slate-300">
                  Staff name:{" "}
                  <span className="text-amber-200">
                    {[savedFirstName, savedLastName].filter(Boolean).join(" ")}
                  </span>
                </span>
              )}
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-semibold text-slate-200"
                htmlFor="ougm-staff-password"
              >
                Password
              </label>
              <input
                autoComplete="new-password"
                className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-400"
                disabled={loading}
                id="ougm-staff-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Minimum 8 characters"
                required
                type="password"
                value={password}
              />
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-semibold text-slate-200"
                htmlFor="ougm-staff-confirm-password"
              >
                Confirm Password
              </label>
              <input
                autoComplete="new-password"
                className="h-12 w-full border border-slate-700 bg-slate-950 px-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-amber-400"
                disabled={loading}
                id="ougm-staff-confirm-password"
                minLength={8}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="Re-enter password"
                required
                type="password"
                value={confirmPassword}
              />
              <p
                className={`text-xs ${
                  passwordReady ? "text-emerald-300" : "text-slate-500"
                }`}
              >
                Passwords must match and contain at least 8 characters.
              </p>
            </div>

            <button
              className="flex min-h-12 w-full items-center justify-center border border-amber-400 bg-amber-400 px-4 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-400"
              disabled={loading || !passwordReady}
              type="submit"
            >
              {loading ? "Creating Account" : "Create Staff Account"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium leading-6 text-red-100"
      role="alert"
    >
      {message}
    </div>
  );
}
