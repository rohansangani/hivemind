"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UserData {
  name: string;
  email: string;
  role: string;
}

export default function WelcomePage() {
  const [user, setUser] = useState<UserData | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          if (data.user.onboarded) {
            router.push("/dashboard");
            return;
          }
          // Non-admin/owner users should never see the setup wizard — redirect to dashboard
          const role = data.user.role;
          if (role !== "owner" && role !== "admin") {
            router.push("/dashboard");
            return;
          }
          setUser(data.user);
        } else {
          router.push("/login");
        }
      })
      .catch(() => router.push("/login"));
  }, [router]);

  const getInitials = (name: string) =>
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 py-12 relative overflow-hidden">
      {/* Background pattern */}
      <svg
        className="absolute inset-0 w-full h-full opacity-[0.025] pointer-events-none"
        viewBox="0 0 800 700"
      >
        <pattern id="hexpat" width="60" height="52" patternUnits="userSpaceOnUse">
          <path
            d="M30 0L60 17.3V52L30 69.3L0 52V17.3Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="0.5"
          />
        </pattern>
        <rect width="800" height="700" fill="url(#hexpat)" />
      </svg>

      <div className="relative z-10 text-center max-w-[520px] w-full">
        {/* Logo */}
        <div
          className="mb-9 animate-fade-in"
          style={{ animationDelay: "0s" }}
        >
          <svg
            width="56"
            height="56"
            viewBox="0 0 32 32"
            className="mx-auto mb-4"
          >
            <path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="var(--hm-text)" strokeWidth="1.5" />
            <circle cx="16" cy="16" r="4" fill="var(--hm-text)" opacity="0.85" />
            <line x1="16" y1="12" x2="16" y2="6" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
            <line x1="19.5" y1="14" x2="24" y2="10" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
            <line x1="19.5" y1="18" x2="24" y2="22" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
            <line x1="16" y1="20" x2="16" y2="26" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
            <line x1="12.5" y1="18" x2="8" y2="22" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
            <line x1="12.5" y1="14" x2="8" y2="10" stroke="var(--hm-text)" strokeWidth="1" opacity="0.5" />
          </svg>
          <h1 className="text-[28px] font-medium text-[var(--hm-text)] mb-2.5 tracking-tight">
            Welcome, {user.name.split(" ")[0]}!
          </h1>
          <p className="text-[15px] text-[var(--hm-text-secondary)] leading-relaxed">
            Let&apos;s get your workspace set up in 4 quick steps — about 5 minutes total.
            <br />
            This helps HiveMind understand your organization and personalize your experience.
          </p>
        </div>

        {/* Steps preview */}
        <div
          className="flex flex-col gap-0 mx-auto max-w-[400px] mb-10 text-left animate-fade-in"
          style={{ animationDelay: "0.15s", animationFillMode: "both" }}
        >
          {[
            {
              icon: "profile",
              title: "Set up your profile",
              desc: "Your name, role, and department",
              active: true,
            },
            {
              icon: "company",
              title: "Tell us about your company",
              desc: "Products, markets, customers, and more",
              active: false,
            },
            {
              icon: "brand",
              title: "Define your brand",
              desc: "Voice, tone, personality, and guidelines",
              active: false,
            },
            {
              icon: "launch",
              title: "Review and launch",
              desc: "Confirm everything and activate HiveMind",
              active: false,
            },
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3.5">
              <div className="flex flex-col items-center">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    step.active
                      ? "bg-[var(--hm-accent)]"
                      : "border-[1.5px] border-[var(--hm-border)] bg-white"
                  }`}
                >
                  {step.active ? (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1v6M5 4h6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      {step.icon === "company" && (
                        <>
                          <rect x="2" y="2" width="12" height="12" rx="2" stroke="#999" strokeWidth="1.2" />
                          <path d="M5 6h6M5 8.5h4" stroke="#999" strokeWidth="1" strokeLinecap="round" />
                        </>
                      )}
                      {step.icon === "brand" && (
                        <>
                          <path d="M8 3v5l3 3" stroke="#999" strokeWidth="1.2" strokeLinecap="round" />
                          <circle cx="8" cy="8" r="6" stroke="#999" strokeWidth="1.2" />
                        </>
                      )}
                      {step.icon === "launch" && (
                        <path d="M3 8l3.5 3.5L13 5" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      )}
                    </svg>
                  )}
                </div>
                {i < 3 && (
                  <div className="w-px h-9 bg-[var(--hm-border)]" />
                )}
              </div>
              <div className="pt-1.5">
                <p
                  className={`text-sm font-medium ${
                    step.active
                      ? "text-[var(--hm-text)]"
                      : "text-[var(--hm-text-secondary)]"
                  }`}
                >
                  {step.title}
                </p>
                <p className="text-[13px] text-[var(--hm-text-tertiary)] mt-0.5">
                  {step.desc}
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* User card */}
        <div
          className="flex items-center gap-3.5 bg-[var(--hm-bg-secondary)] rounded-xl px-5 py-4 max-w-[400px] mx-auto mb-8 animate-fade-in"
          style={{ animationDelay: "0.3s", animationFillMode: "both" }}
        >
          <div className="w-10 h-10 rounded-full bg-[var(--hm-accent)] flex items-center justify-center text-[15px] font-medium text-white flex-shrink-0">
            {getInitials(user.name)}
          </div>
          <div className="text-left flex-1">
            <p className="text-sm font-medium text-[var(--hm-text)]">
              {user.name}
            </p>
            <p className="text-xs text-[var(--hm-text-tertiary)] mt-0.5">
              {user.email}
            </p>
          </div>
          <span className="text-[11px] font-medium px-2.5 py-1 bg-[var(--hm-accent-light)] text-[var(--hm-accent)] rounded-md">
            Admin
          </span>
        </div>

        {/* CTA */}
        <div
          className="animate-fade-in"
          style={{ animationDelay: "0.4s", animationFillMode: "both" }}
        >
          <button
            onClick={() => router.push("/profile-setup")}
            className="h-12 px-10 bg-[var(--hm-accent)] text-white rounded-lg text-[15px] font-medium hover:opacity-90 hover:-translate-y-0.5 transition-all flex items-center gap-2 mx-auto"
          >
            Begin setup
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6 4l4 4-4 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <p className="text-xs text-[var(--hm-text-tertiary)] mt-3.5">
            Step 1 of 7 &middot; You can update these settings any time
          </p>
        </div>
      </div>
    </div>
  );
}