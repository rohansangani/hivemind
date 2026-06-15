"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/superadmin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();

      if (data.success) {
        router.push("/admin-dashboard");
      } else {
        setError(data.error || "Login failed");
      }
    } catch {
      setError("Network error — please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8f9fb]">
      <div className="w-full max-w-[380px] mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[#1a1a2e] mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L2 7l10 5 10-5-10-5z" fill="#4361ee" opacity="0.8" />
              <path d="M2 17l10 5 10-5" stroke="#4361ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 12l10 5 10-5" stroke="#4361ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="text-[20px] font-bold text-[#1a1a2e]">HiveMind Admin</h1>
          <p className="text-[13px] text-[#6b7280] mt-1">Platform management console</p>
        </div>

        <form onSubmit={handleLogin} className="rounded-2xl border border-[#e5e7eb] bg-white p-6 shadow-sm">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-[12px] font-medium text-red-600">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@company.com"
              required
              className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none transition-all"
            />
          </div>

          <div className="mb-5">
            <label className="block text-[12px] font-medium text-[#374151] mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Your HiveMind account password"
              required
              className="w-full rounded-lg border border-[#d1d5db] px-3.5 py-2.5 text-[13px] focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 focus:outline-none transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={loading || !email || !password}
            className="w-full h-[42px] rounded-lg bg-[#1a1a2e] text-white text-[13px] font-semibold hover:bg-[#2a2a4e] disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="32" strokeDashoffset="12" strokeLinecap="round" />
                </svg>
                Signing in...
              </>
            ) : (
              "Sign in to Admin Console"
            )}
          </button>
        </form>

        <p className="text-center text-[11px] text-[#9ca3af] mt-4">
          Access restricted to authorized platform administrators.
        </p>
      </div>
    </div>
  );
}
