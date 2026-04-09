"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Asset {
  id: string;
  name: string;
  fileUrl: string;
  fileType: string;
  fileName: string;
}

export default function FileViewerPage() {
  const { id } = useParams<{ id: string }>();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetch(`/api/content-library/asset/${id}`)
      .then((r) => {
        if (r.status === 404) throw new Error("not_found");
        if (!r.ok) throw new Error("server_error");
        return r.json();
      })
      .then((d) => {
        if (d.asset) setAsset(d.asset);
        else setError("not_found");
      })
      .catch((e) => setError(e.message || "server_error"));
  }, [id]);

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  if (error) return (
    <div className="flex-1 flex items-center justify-center flex-col gap-3">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" className="text-[var(--hm-text-tertiary)]">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5"/>
        <path d="M12 8v4M12 16h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
      </svg>
      <p className="text-[15px] font-medium">
        {error === "not_found" ? "File not found" : "Something went wrong"}
      </p>
      <p className="text-[12px] text-[var(--hm-text-tertiary)]">
        {error === "not_found"
          ? "This file may have been deleted or the link is invalid."
          : "There was a problem loading the file. Please try again."}
      </p>
      <Link href="/content-library" className="text-[13px] text-[#4361ee] hover:underline mt-1">← Back to asset library</Link>
    </div>
  );

  if (!asset) return (
    <div className="flex-1 flex items-center justify-center gap-3">
      <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
      <span className="text-[13px] text-[var(--hm-text-tertiary)]">Loading file…</span>
    </div>
  );

  const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(asset.fileType?.toLowerCase());
  const isPdf = asset.fileType?.toLowerCase() === "pdf";

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Thin header bar */}
      <div className="px-5 py-2.5 bg-white border-b border-[var(--hm-border)] flex items-center gap-3 flex-shrink-0">
        <Link href="/content-library" className="flex items-center gap-1.5 text-[12px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] transition-colors">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          Asset library
        </Link>
        <span className="text-[var(--hm-border)]">/</span>
        <p className="text-[13px] font-medium truncate flex-1">{asset.name}</p>

        {/* Share / copy URL */}
        <button
          onClick={handleCopyUrl}
          title="Copy link to this file"
          className="h-7 px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors flex-shrink-0"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 8a3 3 0 0 0 4.243 0l2-2a3 3 0 0 0-4.243-4.243l-1 1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><path d="M10 8a3 3 0 0 0-4.243 0l-2 2a3 3 0 0 0 4.243 4.243l1-1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          {copiedUrl ? "Link copied!" : "Share"}
        </button>

        <a
          href={asset.fileUrl}
          download={asset.fileName}
          className="h-7 px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] flex items-center gap-1.5 transition-colors flex-shrink-0"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>
          Download
        </a>
      </div>

      {/* File content */}
      <div className="flex-1 overflow-auto bg-[var(--hm-bg-tertiary)] flex items-start justify-center p-6">
        {isPdf && (
          <iframe
            src={asset.fileUrl}
            className="w-full max-w-4xl rounded-xl shadow-lg border border-[var(--hm-border)]"
            style={{ height: "calc(100vh - 120px)" }}
            title={asset.name}
          />
        )}
        {isImage && (
          <img
            src={asset.fileUrl}
            alt={asset.name}
            className="max-w-4xl w-full rounded-xl shadow-lg border border-[var(--hm-border)] object-contain"
          />
        )}
        {!isPdf && !isImage && (
          <div className="bg-white border border-[var(--hm-border)] rounded-xl p-10 text-center max-w-sm">
            <div className="w-14 h-14 rounded-xl bg-[var(--hm-bg-secondary)] flex items-center justify-center mx-auto mb-4 text-[11px] font-bold text-[var(--hm-text-tertiary)]">
              {asset.fileType?.toUpperCase() || "FILE"}
            </div>
            <p className="text-[14px] font-medium mb-1">{asset.name}</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-5">Preview not available for this file type.</p>
            <a
              href={asset.fileUrl}
              download={asset.fileName}
              className="inline-flex items-center gap-2 h-9 px-5 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90"
            >
              Download file
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
