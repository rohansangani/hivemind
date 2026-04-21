"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();

  // Auto-focus refs
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Auto-focus first field whenever the tab changes
  useEffect(() => {
    if (tab === "signup" && nameRef.current) {
      nameRef.current.focus();
    } else if (tab === "login" && emailRef.current) {
      emailRef.current.focus();
    }
  }, [tab]);

  // Also auto-focus on initial mount (login tab)
  useEffect(() => {
    if (emailRef.current) emailRef.current.focus();
  }, []);

  // Show OAuth errors from redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("error");
    if (oauthError === "google_cancelled") setError("Google sign-in was cancelled.");
    else if (oauthError === "google_email_unverified") setError("Google account email is not verified.");
    else if (oauthError === "google_not_configured") setError("Google sign-in is not configured.");
    else if (oauthError) setError("Google sign-in failed. Please try again.");
  }, []);

  const validateEmail = (value: string) => {
    if (!value) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
      return "Enter a valid email address";
    return "";
  };

  const validatePassword = (value: string) => {
    if (!value) return "Password is required";
    if (tab === "signup") {
      if (value.length < 8) return "Must be at least 8 characters";
      if (!/[A-Z]/.test(value)) return "Must contain an uppercase letter";
      if (!/[a-z]/.test(value)) return "Must contain a lowercase letter";
      if (!/[0-9]/.test(value)) return "Must contain a number";
    }
    return "";
  };

  const handleSubmit = useCallback(async () => {
    // Client-side validation
    const eErr = validateEmail(email);
    const pErr = validatePassword(password);
    const hasNameErr = tab === "signup" && !name.trim();

    setEmailError(eErr);
    setPasswordError(pErr);
    if (eErr || pErr || hasNameErr) {
      if (hasNameErr) setError("Full name is required");
      return;
    }

    setError("");
    setLoading(true);

    try {
      const endpoint = tab === "login" ? "/api/auth/login" : "/api/auth/signup";
      const body =
        tab === "login"
          ? { email, password }
          : { email, password, name };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong");
        return;
      }

      if (data.joinedOrg) {
        // Joined an existing workspace as viewer — show brief message then redirect
        setSuccessMessage(`You've joined ${data.orgName} as a viewer.`);
        setTimeout(() => router.push("/dashboard"), 1800);
      } else if (data.user.onboarded) {
        router.push("/dashboard");
      } else {
        router.push("/welcome");
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, email, password, name, router]);

  // Submit on Enter key from any field
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel — brand */}
      <div className="hidden lg:flex w-[44%] bg-gradient-to-br from-[#1a1a2e] via-[#16213e] to-[#0f3460] flex-col justify-between p-10 relative overflow-hidden">
        {/* Hex pattern */}
        <svg
          aria-hidden="true"
          className="absolute inset-0 w-full h-full opacity-[0.04]"
          viewBox="0 0 400 700"
        >
          <pattern
            id="hex"
            width="56"
            height="48.5"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M28 0L56 16.5V48.5L28 65L0 48.5V16.5Z"
              fill="none"
              stroke="#fff"
              strokeWidth="0.5"
            />
          </pattern>
          <rect width="400" height="700" fill="url(#hex)" />
        </svg>

        <div className="relative z-10">
          {/* Logo */}
          <div className="flex items-center gap-2.5 mb-12">
            <svg aria-hidden="true" width="32" height="32" viewBox="0 0 32 32">
              <path
                d="M16 2L28 9v14l-12 7L4 23V9z"
                fill="none"
                stroke="#4361ee"
                strokeWidth="1.5"
              />
              <circle cx="16" cy="16" r="4" fill="#4361ee" opacity="0.8" />
              <line x1="16" y1="12" x2="16" y2="6" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="19.5" y1="14" x2="24" y2="10" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="19.5" y1="18" x2="24" y2="22" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="16" y1="20" x2="16" y2="26" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="12.5" y1="18" x2="8" y2="22" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
              <line x1="12.5" y1="14" x2="8" y2="10" stroke="#4361ee" strokeWidth="1" opacity="0.5" />
            </svg>
            <span className="text-xl font-medium text-white tracking-wide">
              HiveMind
            </span>
          </div>

          <h1 className="text-[28px] font-medium text-white leading-tight mb-4">
            Your marketing team&apos;s
            <br />
            collective intelligence
          </h1>
          <p className="text-sm text-white/50 leading-relaxed max-w-[280px]">
            One platform for your brand knowledge, content assets, and
            AI-powered content creation.
          </p>
        </div>

        {/* Feature pills */}
        <div className="relative z-10 flex flex-col gap-3">
          {["Knowledge repository", "Content library", "AI content generator"].map(
            (feature) => (
              <div key={feature} className="flex items-center gap-2.5">
                <div aria-hidden="true" className="w-1.5 h-1.5 rounded-full bg-[#4361ee]" />
                <span className="text-[13px] text-white/45">{feature}</span>
              </div>
            )
          )}
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-10">
        <div className="w-full max-w-[340px]">
          {/* Tabs */}
          <div role="tablist" className="flex border-b border-[var(--hm-border)]  mb-8">
            <button
              role="tab"
              aria-selected={tab === "login"}
              onClick={() => { setTab("login"); setError(""); setEmailError(""); setPasswordError(""); }}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-all ${
                tab === "login"
                  ? "text-[var(--hm-text)] border-[var(--hm-text)]"
                  : "text-[var(--hm-text-tertiary)] border-transparent"
              }`}
            >
              Log in
            </button>
            <button
              role="tab"
              aria-selected={tab === "signup"}
              onClick={() => { setTab("signup"); setError(""); setEmailError(""); setPasswordError(""); }}
              className={`flex-1 pb-3 text-sm font-medium border-b-2 transition-all ${
                tab === "signup"
                  ? "text-[var(--hm-text)] border-[var(--hm-text)]"
                  : "text-[var(--hm-text-tertiary)] border-transparent"
              }`}
            >
              Sign up
            </button>
          </div>

          {/* Google SSO */}
          <button
            type="button"
            disabled={googleLoading}
            onClick={() => {
              setGoogleLoading(true);
              window.location.href = "/api/auth/google";
            }}
            className="w-full h-11 flex items-center justify-center gap-2.5 border border-[var(--hm-border)] rounded-lg text-sm text-[var(--hm-text-secondary)] hover:bg-[var(--hm-surface-hover)] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {googleLoading ? (
              <span className="w-4 h-4 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 001 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
            )}
            <span>Continue with Google</span>
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-[var(--hm-border)]" />
            <span className="text-xs text-[var(--hm-text-tertiary)]">or</span>
            <div className="flex-1 h-px bg-[var(--hm-border)]" />
          </div>

          {/* Success message (e.g. joined existing workspace) */}
          {successMessage && (
            <div role="status" className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-700 animate-fade-in-fast">
              {successMessage} Redirecting…
            </div>
          )}

          {/* Error message */}
          {error && (
            <div role="alert" className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600 animate-fade-in-fast">
              {error}
            </div>
          )}

          <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} noValidate>

          {/* Signup: Name field */}
          {tab === "signup" && (
            <div className="mb-4 animate-fade-in-fast">
              <label htmlFor="name" className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                Full name
              </label>
              <input
                id="name"
                ref={nameRef}
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleKeyDown}
                autoComplete="name"
                className="w-full"
              />
            </div>
          )}

          {/* Email */}
          <div className="mb-4">
            <label htmlFor="email" className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
              {tab === "signup" ? "Work email" : "Email"}
            </label>
            <input
              id="email"
              ref={emailRef}
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => { setEmail(e.target.value); if (emailError) setEmailError(""); }}
              onBlur={(e) => setEmailError(validateEmail(e.target.value))}
              onKeyDown={handleKeyDown}
              autoComplete="email"
              className={`w-full${emailError ? " border-red-400 focus:border-red-400 focus:ring-red-200" : ""}`}
            />
            {emailError && (
              <p className="text-[11px] text-red-500 mt-1">{emailError}</p>
            )}
          </div>

          {/* Password */}
          <div className={tab === "login" ? "mb-2" : "mb-6"}>
            <label htmlFor="password" className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                placeholder={
                  tab === "signup" ? "Min 8 characters" : "Enter your password"
                }
                value={password}
                onChange={(e) => { setPassword(e.target.value); if (passwordError) setPasswordError(""); }}
                onBlur={(e) => setPasswordError(validatePassword(e.target.value))}
                onKeyDown={handleKeyDown}
                autoComplete={tab === "signup" ? "new-password" : "current-password"}
                className={`w-full pr-10${passwordError ? " border-red-400 focus:border-red-400 focus:ring-red-200" : ""}`}
              />
              {/* Password visibility toggle */}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text-secondary)] transition-colors"
              >
                {showPassword ? (
                  /* Eye-off icon */
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  /* Eye icon */
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
            {passwordError && (
              <p className="text-[11px] text-red-500 mt-1">{passwordError}</p>
            )}
            {tab === "signup" && !passwordError && (
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1.5">
                Must contain uppercase, lowercase, and a number
              </p>
            )}
          </div>

          {/* Forgot password — coming soon */}
          {tab === "login" && (
            <div className="text-right mb-6">
              <div className="relative inline-block group">
                <button
                  disabled
                  aria-disabled="true"
                  className="text-xs text-[var(--hm-accent)] opacity-50 cursor-not-allowed"
                >
                  Forgot password?
                </button>
                {/* Tooltip */}
                <div className="pointer-events-none absolute -top-8 right-0 whitespace-nowrap rounded bg-[var(--hm-text)] px-2 py-1 text-[11px] text-[var(--hm-bg,#fff)] opacity-0 transition-opacity group-hover:opacity-100">
                  Coming soon
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 bg-[var(--hm-accent)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? (
              <span role="status" aria-label="Signing in" className="flex items-center justify-center gap-2">
                <span aria-hidden="true" className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="sr-only">Loading…</span>
              </span>
            ) : tab === "login" ? (
              "Log in"
            ) : (
              "Create account"
            )}
          </button>

          </form>

          {/* Footer */}
          <p className="text-[11px] text-[var(--hm-text-tertiary)] text-center mt-6 leading-relaxed">
            By continuing, you agree to HiveMind&apos;s
            <br />
            <button type="button" className="text-[var(--hm-accent)] hover:underline">
              Terms of Service
            </button>{" "}
            and{" "}
            <button type="button" className="text-[var(--hm-accent)] hover:underline">
              Privacy Policy
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
