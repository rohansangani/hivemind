"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface UserData {
  id: string;
  name: string;
  email: string;
  role: string;
  organizationId: string;
  organization: { name: string } | null;
}

export default function ProfileSetupPage() {
  const [user, setUser] = useState<UserData | null>(null);
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [website, setWebsite] = useState("");
  const [department, setDepartment] = useState("");
  const [jobRole, setJobRole] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    // Fetch identity first so we can show the avatar / email
    fetch("/api/auth/me")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          // Non-admin/owner users should never see the setup wizard
          if (data.user.role !== "owner" && data.user.role !== "admin") {
            router.push("/dashboard");
            return;
          }
          setUser(data.user);
        } else {
          router.push("/login");
        }
      })
      .catch(() => router.push("/login"));

    // Fetch existing profile data to pre-populate the form
    fetch("/api/profile-setup")
      .then((res) => res.json())
      .then((data) => {
        if (data.user) {
          setName(data.user.name || "");
          setDepartment(data.user.department || "");
          setJobRole(data.user.jobRole || "");
          setJobTitle(data.user.jobTitle || "");
          const orgName = data.user.organization?.name;
          if (orgName && orgName !== "My Organization") {
            setCompanyName(orgName);
          }
          const orgWebsite = data.user.organization?.website;
          if (orgWebsite) {
            setWebsite(orgWebsite.replace(/^https?:\/\//, ""));
          }
        }
      })
      .catch(() => {
        // Non-fatal: form stays blank, user can fill it in manually
      });
  }, [router]);

  const handleContinue = async () => {
    if (!name.trim() || !companyName.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/profile-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          companyName,
          website: website ? `https://${website.replace(/^https?:\/\//, "")}` : "",
          department,
          jobRole,
          jobTitle,
        }),
      });

      if (res.ok) {
        router.push("/setup-wizard");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch {
      setError("Unable to save your profile. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSaveLater = async () => {
    if (!name.trim() || !companyName.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profile-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          companyName,
          website: website ? `https://${website.replace(/^https?:\/\//, "")}` : "",
          department,
          jobRole,
          jobTitle,
        }),
      });
      if (res.ok) {
        router.push("/dashboard");
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Unable to save. Please try again.");
      }
    } catch {
      setError("Unable to save your profile. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (n: string) =>
    n.split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Left sidebar — progress */}
      <div className="w-[260px] bg-[var(--hm-bg-secondary)] border-r border-[var(--hm-border)] p-7 flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-10">
            <svg width="24" height="24" viewBox="0 0 32 32">
              <path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="var(--hm-text)" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="4" fill="var(--hm-text)" opacity="0.85" />
            </svg>
            <span className="text-[15px] font-medium text-[var(--hm-text)] tracking-wide">
              HiveMind
            </span>
          </div>

          <div className="flex flex-col">
            {[
              { num: "1", label: "Your profile", sub: "Name, role & department", active: true },
              { num: "2", label: "Company info", sub: "Description & industry", active: false },
              { num: "3", label: "Markets & products", sub: "", active: false },
              { num: "4", label: "Customers & personas", sub: "", active: false },
              { num: "5", label: "Competition", sub: "", active: false },
              { num: "6", label: "Brand identity", sub: "", active: false },
              { num: "7", label: "Review & launch", sub: "", active: false },
            ].map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      step.active
                        ? "bg-[var(--hm-accent)] text-white"
                        : "border-[1.5px] border-[var(--hm-border)] text-[var(--hm-text-tertiary)] bg-white"
                    }`}
                  >
                    {step.num}
                  </div>
                  {i < 6 && <div className={`w-px h-8 ${step.active ? "bg-[var(--hm-accent)]/30" : "bg-[var(--hm-border)]"}`} />}
                </div>
                <div className="pt-1">
                  <p className={`text-[13px] font-medium ${step.active ? "text-[var(--hm-accent)]" : "text-[var(--hm-text-tertiary)]"}`}>
                    {step.label}
                  </p>
                  {step.sub && (
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{step.sub}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-3 border-t border-[var(--hm-border)]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="6.5" stroke="#999" strokeWidth="1" />
            <path d="M6.5 6.5a1.5 1.5 0 113 0c0 .83-.67 1-1.5 1.5M8 11h.01" stroke="#999" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <span className="text-xs text-[var(--hm-text-tertiary)]">Need help? Chat with us</span>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col">
        {/* Top bar */}
        <div className="px-9 py-5 border-b border-[var(--hm-border)] flex items-center justify-between">
          <p className="text-xs text-[var(--hm-text-tertiary)] uppercase tracking-wider font-medium">
            Step 1 of 7
          </p>
          <div className="flex items-center gap-2">
            <div className="w-[120px] h-1 rounded-full bg-[var(--hm-border)] overflow-hidden">
              <div className="w-[14%] h-full bg-[var(--hm-accent)] rounded-full" />
            </div>
            <span className="text-[11px] text-[var(--hm-text-tertiary)]">14%</span>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 overflow-y-auto px-9 py-10">
          <div className="max-w-[480px] animate-fade-in">
            <h2 className="text-[22px] font-medium text-[var(--hm-text)] mb-1.5">
              Set up your profile
            </h2>
            <p className="text-sm text-[var(--hm-text-secondary)] mb-1 leading-relaxed">
              This helps your team identify you and lets HiveMind personalize
              your experience.
            </p>
            <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-7">
              Fields marked <span className="text-red-500 font-medium">*</span> are required.
            </p>

            {/* API error banner */}
            {error && (
              <div className="flex items-start gap-2.5 p-3.5 bg-red-50 border border-red-200 rounded-lg mb-6" role="alert">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-px">
                  <circle cx="8" cy="8" r="7" stroke="#ef4444" strokeWidth="1.2" />
                  <path d="M8 5v3.5M8 10.5h.01" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                <p className="text-[13px] text-red-700 leading-snug">{error}</p>
              </div>
            )}

            {/* Avatar card */}
            <div className="flex items-center gap-4 p-4 bg-[var(--hm-bg-secondary)] rounded-xl mb-7">
              <div className="w-14 h-14 rounded-full bg-[var(--hm-accent)] flex items-center justify-center text-xl font-medium text-white flex-shrink-0">
                {getInitials(name || user.name)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-[var(--hm-text)]">
                  {name || user.name}
                </p>
                <p className="text-xs text-[var(--hm-text-tertiary)] mt-0.5">
                  {user.email}
                </p>
              </div>
              <span className="text-[11px] text-[var(--hm-text-tertiary)] italic">
                Auto-generated
              </span>
            </div>

            {/* Full name */}
            <div className="mb-5">
              <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                Full name{" "}
                <span className="text-red-500 font-medium" aria-hidden="true">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full"
              />
            </div>

            {/* Company name */}
            <div className="mb-5">
              <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                Company name{" "}
                <span className="text-red-500 font-medium" aria-hidden="true">*</span>
              </label>
              <input
                type="text"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                placeholder="e.g., ClickPost"
                className="w-full"
              />
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">
                This will be your workspace name in HiveMind
              </p>
            </div>

            {/* Company website */}
            <div className="mb-5">
              <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                Company website
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-[var(--hm-text-tertiary)]">
                  https://
                </span>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="www.clickpost.ai"
                  className="w-full"
                  style={{ paddingLeft: "62px" }}
                />
              </div>
              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">
                HiveMind will use this to learn about your company from the web
              </p>
            </div>

            {/* Department + Role */}
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                  Department
                </label>
                <select
                  value={department}
                  onChange={(e) => setDepartment(e.target.value)}
                  className="w-full h-[38px] cursor-pointer"
                >
                  <option value="">Select...</option>
                  <option value="marketing">Marketing</option>
                  <option value="sales">Sales</option>
                  <option value="product">Product</option>
                  <option value="engineering">Engineering</option>
                  <option value="operations">Operations</option>
                  <option value="design">Design</option>
                  <option value="hr">Human Resources</option>
                  <option value="finance">Finance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                  Your role
                </label>
                <select
                  value={jobRole}
                  onChange={(e) => setJobRole(e.target.value)}
                  className="w-full h-[38px] cursor-pointer"
                >
                  <option value="">Select...</option>
                  <option value="cxo">CXO / C-Suite</option>
                  <option value="vp">Vice President</option>
                  <option value="head">Head / Director</option>
                  <option value="manager">Manager</option>
                  <option value="lead">Team Lead</option>
                  <option value="specialist">Specialist</option>
                  <option value="analyst">Analyst</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>

            {/* Job title */}
            <div className="mb-5">
              <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                Job title{" "}
                <span className="font-normal text-[var(--hm-text-tertiary)]">
                  (optional)
                </span>
              </label>
              <input
                type="text"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g., Head of Marketing"
                className="w-full"
              />
            </div>

            {/* Admin badge */}
            <div className="flex items-center gap-2.5 p-3 bg-[var(--hm-bg-secondary)] rounded-lg mb-8">
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M8 1l1.76 3.57L14 5.31l-3 2.92.71 4.12L8 10.42l-3.71 1.93.71-4.12-3-2.92 4.24-.74z"
                  stroke="#4361ee"
                  strokeWidth="1"
                  fill="#4361ee"
                  fillOpacity="0.15"
                />
              </svg>
              <div>
                <p className="text-[13px] font-medium text-[var(--hm-text)]">
                  Platform role: Admin
                </p>
                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">
                  As the first user, you have full admin access to configure
                  HiveMind for your organization.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="px-9 py-4 border-t border-[var(--hm-border)] flex items-center justify-between">
          <button
            onClick={() => router.push("/welcome")}
            className="h-[38px] px-5 border border-[var(--hm-border)] rounded-lg text-[13px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-all flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveLater}
              disabled={loading || !name.trim() || !companyName.trim()}
              className="h-[38px] px-5 text-[13px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text-secondary)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              title={!name.trim() ? "Enter your name to save" : !companyName.trim() ? "Enter a company name to save" : undefined}
            >
              Save &amp; finish later
            </button>
            <button
              onClick={handleContinue}
              disabled={loading || !name.trim() || !companyName.trim()}
              className="h-[38px] px-6 bg-[var(--hm-accent)] text-white rounded-lg text-[13px] font-medium hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  Continue
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M6 4l4 4-4 4" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}