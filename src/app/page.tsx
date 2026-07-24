"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogoLoader } from "@/components/LogoLoader";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.onboarded) router.push("/dashboard");
        else if (d.user) router.push("/welcome");
        else router.push("/login");
      })
      .catch(() => router.push("/login"));
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <LogoLoader size={44} />
    </div>
  );
}