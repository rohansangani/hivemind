import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HiveMind — AI Marketing Intelligence",
  description: "AI-powered marketing intelligence platform for cross-functional teams",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* Apply saved theme before first paint to avoid flash */}
      <head>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            document.documentElement.classList.remove('dark');
            document.documentElement.classList.add('light');
          })();
        ` }} />
      </head>
      <body className="min-h-screen antialiased" style={{ background: "var(--hm-bg)", color: "var(--hm-text)" }}>{children}</body>
    </html>
  );
}