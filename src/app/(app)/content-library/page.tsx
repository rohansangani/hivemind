"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { LogoLoader } from "@/components/LogoLoader";
import { upload } from "@vercel/blob/client";
import { useUser } from "@/lib/UserContext";
import ModuleTour from "@/components/ModuleTour";

interface Asset {
  id: string; name: string; fileName: string; fileUrl: string | null; fileType: string; fileSize: number | null;
  contentType: string; brandScore: number | null; scoreVoice: number | null; scoreTerminology: number | null;
  scoreMessaging: number | null; scorePersonality: number | null; scoreCompleteness: number | null;
  aiSummary: string | null; scoreSuggestions: string[];
  sourceUrl: string | null;
  productTags: string[]; marketTags: string[]; personaTags: string[]; competitorTags: string[]; uploadedBy: { name: string }; createdAt: string; scoreStatus: string;
  intelligenceStatus: string; analyzedAt: string | null;
}

interface ReviewSection {
  excerpt: string;
  issue: string;
  dimension: string;
  severity: "high" | "medium" | "low";
  suggestion: string;
}

interface BrandReview {
  summary: string;
  overallScore: number;
  dimensions: Record<string, { score: number; label: string; assessment: string }>;
  sections: ReviewSection[];
  priorityFixes: string[];
}

export default function ContentLibraryPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [avgScore, setAvgScore] = useState<number | null>(null);
  const [products, setProducts] = useState<{ name: string; marketNames?: string[]; personaNames?: string[]; competitorNames?: string[] }[]>([]);
  const [markets, setMarkets] = useState<{ name: string }[]>([]);
  const [personas, setPersonas] = useState<{ title: string }[]>([]);
  const [competitors, setCompetitors] = useState<{ name: string }[]>([]);
  const [view, setView] = useState<"tile" | "list" | "grouped" | "compact">("tile");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState("pdf");
  const [uploadContentType, setUploadContentType] = useState("deck");
  const [uploadProduct, setUploadProduct] = useState("");
  const [uploadMarket, setUploadMarket] = useState("");
  const [uploadSourceUrl, setUploadSourceUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterMarket, setFilterMarket] = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [filterScoreStatus, setFilterScoreStatus] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [duplicateWarning, setDuplicateWarning] = useState<{ duplicates: Array<{ fileName: string; existingName: string; uploadedAt: string }>; payload: Record<string, unknown> } | null>(null);

  // Panel state (replaces inline edit panel)
  const [panelAsset, setPanelAsset] = useState<Asset | null>(null);
  const [panelTab, setPanelTab] = useState<"score" | "edit">("score");

  // Edit state (inside panel)
  const [editName, setEditName] = useState("");
  const [editContentType, setEditContentType] = useState("");
  const [editProductTags, setEditProductTags] = useState<string[]>([]);
  const [editMarketTags, setEditMarketTags] = useState<string[]>([]);
  const [editPersonaTags, setEditPersonaTags] = useState<string[]>([]);
  const [editCompetitorTags, setEditCompetitorTags] = useState<string[]>([]);
  const [editSourceUrl, setEditSourceUrl] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  // Auto-review polling state
  const [isAutoReviewing, setIsAutoReviewing] = useState(false);
  const [batchAnalyzing, setBatchAnalyzing] = useState(false);
  const [batchResult, setBatchResult] = useState<{ analyzed: number; total: number; message: string } | null>(null);

  const runBatchAnalyze = async () => {
    setBatchAnalyzing(true);
    setBatchResult(null);
    try {
      const res = await fetch("/api/content-library/analyze-batch", { method: "POST" });
      const data = await res.json();
      setBatchResult(data);
      fetchData();
    } catch {
      setBatchResult({ analyzed: 0, total: 0, message: "Batch analysis failed." });
    } finally {
      setBatchAnalyzing(false);
      setTimeout(() => setBatchResult(null), 15000);
    }
  };

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Brand review state
  const [brandReview, setBrandReview] = useState<BrandReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [runningReview, setRunningReview] = useState(false);
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  const fileRef = useRef<File | null>(null);
  const loadingRef = useRef(false);
  const user = useUser();

  const fetchData = useCallback((pageNum?: number) => {
    const p = pageNum ?? page;
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterType) params.set("type", filterType);
    if (filterProduct) params.set("product", filterProduct);
    if (filterMarket) params.set("market", filterMarket);
    if (filterScore) params.set("score", filterScore);
    if (filterScoreStatus) params.set("scoreStatus", filterScoreStatus);
    params.set("page", String(p));
    if (p === 1) { setLoading(true); loadingRef.current = true; }
    else { setLoadingMore(true); loadingRef.current = true; }
    setFetchError(false);
    fetch("/api/content-library?" + params.toString())
      .then((r) => r.json())
      .then((d) => {
        const incoming = d.assets || [];
        if (p === 1) setAssets(incoming);
        else setAssets((prev) => [...prev, ...incoming]);
        setAvgScore(d.avgScore);
        setProducts(d.products || []);
        setMarkets(d.markets || []);
        setPersonas(d.personas || []);
        setCompetitors(d.competitors || []);
        const pag = d.pagination;
        if (pag) {
          setTotalCount(pag.total);
          setHasMore(p < pag.totalPages);
        } else {
          setHasMore(false);
        }
      })
      .catch(() => setFetchError(true))
      .finally(() => { setLoading(false); setLoadingMore(false); loadingRef.current = false; });
  }, [search, filterType, filterProduct, filterMarket, filterScore, filterScoreStatus, page]);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
    setHasMore(true);
  }, [search, filterType, filterProduct, filterMarket, filterScore, filterScoreStatus]);

  // Infinite scroll — observe sentinel element
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current) {
          setPage((p) => p + 1);
        }
      },
      { root: scrollContainerRef.current, rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, assets.length]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Auto-poll every 5s while any visible asset is pending review — merge updates in place
  useEffect(() => {
    const hasPending = assets.some(a => a.scoreStatus === "pending" || a.intelligenceStatus === "extracting");
    if (!hasPending) {
      if (isAutoReviewing) setIsAutoReviewing(false);
      return;
    }
    const id = setInterval(() => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (filterType) params.set("type", filterType);
      if (filterProduct) params.set("product", filterProduct);
      if (filterMarket) params.set("market", filterMarket);
      if (filterScore) params.set("score", filterScore);
      if (filterScoreStatus) params.set("scoreStatus", filterScoreStatus);
      params.set("page", "1");
      params.set("limit", "100");
      fetch("/api/content-library?" + params.toString())
        .then(r => r.json())
        .then(d => {
          const fresh = d.assets || [];
          const freshMap = new Map(fresh.map((a: Asset) => [a.id, a]));
          setAssets(prev => prev.map(a => (freshMap.get(a.id) as Asset) || a));
          if (d.avgScore != null) setAvgScore(d.avgScore);
        })
        .catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [assets, isAutoReviewing, search, filterType, filterProduct, filterMarket, filterScore, filterScoreStatus]);

  const handleFileSelect = (file: File) => { fileRef.current = file; setUploadName(file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")); setUploadType(file.name.split(".").pop()?.toLowerCase() || "pdf"); };
  const resetUpload = () => { setShowUpload(false); setUploadName(""); setUploadSourceUrl(""); setUploadProgress(""); setUploadError(""); setDuplicateWarning(null); fileRef.current = null; };

  const computeFileHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
  };

  const saveAsset = async (payload: Record<string, unknown>) => {
    setUploadProgress("Saving...");
    try {
      const res = await fetch("/api/content-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (res.status === 409 && data.duplicates) {
        setDuplicateWarning({ duplicates: data.duplicates, payload });
        setUploading(false); setUploadProgress(""); return;
      }
      if (!res.ok) { setUploadError(data.error || "Failed to save asset."); }
      else { resetUpload(); fetchData(); setIsAutoReviewing(true); }
    } catch (e) { console.error(e); setUploadError("Failed to save asset. Please try again."); }
    finally { setUploading(false); setUploadProgress(""); }
  };

  const forceSaveDuplicate = async () => {
    if (!duplicateWarning) return;
    setUploading(true); setDuplicateWarning(null);
    await saveAsset({ ...duplicateWarning.payload, force: true });
  };

  const handleUpload = async () => {
    if (!uploadName.trim()) return;
    setUploading(true);
    setUploadError("");
    setDuplicateWarning(null);
    let fileUrl: string | null = null; let fileSize: number | null = null; let actualFileName: string | null = null; let fileHash: string | null = null;
    if (fileRef.current) {
      setUploadProgress("Checking file...");
      const file = fileRef.current;
      try { fileHash = await computeFileHash(file); } catch { /* hash optional */ }
      setUploadProgress("Uploading file...");
      const SMALL_FILE_LIMIT = 4 * 1024 * 1024;
      try {
        if (file.size <= SMALL_FILE_LIMIT) {
          const res = await fetch(
            `/api/upload?filename=${encodeURIComponent(file.name)}`,
            { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }
          );
          let data: Record<string, unknown> = {};
          try { data = await res.json(); } catch { /* empty body */ }
          if (!res.ok) { setUploadError((data.error as string) || `Upload failed (${res.status})`); setUploading(false); setUploadProgress(""); return; }
          fileUrl = data.fileUrl as string; fileSize = file.size; actualFileName = file.name;
        } else {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000);
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blob = await upload(`assets/${Date.now()}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/upload", ...(({ abortSignal: controller.signal }) as any) });
            clearTimeout(timeout);
            fileUrl = blob.url; fileSize = file.size; actualFileName = file.name;
          } catch (e) { clearTimeout(timeout); throw e; }
        }
      } catch (e) { console.error(e); setUploadError((e as Error)?.message || "Upload failed. Please try again."); setUploading(false); setUploadProgress(""); return; }
    }
    const selectedProd = uploadProduct ? products.find(p => p.name === uploadProduct) : null;
    const autoPersonaTags = selectedProd?.personaNames || [];
    const autoCompetitorTags = selectedProd?.competitorNames || [];
    const autoMarketTags = uploadMarket ? [uploadMarket] : selectedProd?.marketNames || [];
    const payload = { files: [{ name: uploadName, fileName: actualFileName || uploadName.toLowerCase().replace(/\s+/g, "-") + "." + uploadType, fileUrl, fileSize, fileHash, fileType: uploadType, contentType: uploadContentType, sourceUrl: uploadSourceUrl.trim() || null, productTags: uploadProduct ? [uploadProduct] : [], marketTags: autoMarketTags, personaTags: autoPersonaTags, competitorTags: autoCompetitorTags }] };
    await saveAsset(payload);
  };

  const openPanel = async (a: Asset) => {
    setPanelAsset(a);
    setPanelTab("score");
    setEditName(a.name);
    setEditContentType(a.contentType);
    setEditProductTags([...a.productTags]);
    setEditMarketTags([...a.marketTags]);
    setEditPersonaTags([...(a.personaTags || [])]);
    setEditCompetitorTags([...(a.competitorTags || [])]);
    setEditSourceUrl(a.sourceUrl || "");
    setBrandReview(null);
    setExpandedSection(null);

    // Load stored review if available
    if (a.scoreStatus === "analyzed") {
      setReviewLoading(true);
      try {
        const res = await fetch(`/api/content-library/brand-review?assetId=${a.id}`);
        const data = await res.json();
        if (data.review) setBrandReview(data.review);
      } catch { /* silent */ }
      finally { setReviewLoading(false); }
    }
  };

  const closePanel = () => { setPanelAsset(null); setBrandReview(null); };

  const runBrandReview = async () => {
    if (!panelAsset) return;
    setRunningReview(true);
    setBrandReview(null);
    try {
      const res = await fetch("/api/content-library/brand-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: panelAsset.id }),
      });
      const data = await res.json();
      if (data.review) {
        setBrandReview(data.review);
        // Update local asset state to reflect new scores
        fetchData();
        setPanelAsset(prev => prev ? {
          ...prev,
          brandScore: data.review.overallScore,
          scoreVoice: data.review.dimensions.voice?.score ?? null,
          scoreTerminology: data.review.dimensions.terminology?.score ?? null,
          scoreMessaging: data.review.dimensions.messaging?.score ?? null,
          scorePersonality: data.review.dimensions.personality?.score ?? null,
          scoreCompleteness: data.review.dimensions.completeness?.score ?? null,
          aiSummary: data.review.summary,
          scoreSuggestions: data.review.priorityFixes || [],
          scoreStatus: "analyzed",
        } : null);
      } else {
        alert(data.error || "Review failed");
      }
    } catch { alert("Something went wrong"); }
    finally { setRunningReview(false); }
  };

  const saveAssetEdit = async () => {
    if (!panelAsset) return;
    setSavingEdit(true);
    try { await fetch("/api/content-library/manage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: panelAsset.id, name: editName, contentType: editContentType, productTags: editProductTags, marketTags: editMarketTags, personaTags: editPersonaTags, competitorTags: editCompetitorTags, sourceUrl: editSourceUrl.trim() || null }) }); fetchData(); setPanelTab("score"); } catch { alert("Failed to save"); }
    finally { setSavingEdit(false); }
  };

  const deleteAsset = async () => {
    if (!panelAsset) return;
    setDeleteConfirm(false);
    try { await fetch("/api/content-library/manage?id=" + panelAsset.id, { method: "DELETE" }); closePanel(); fetchData(); } catch { alert("Failed to delete"); }
  };

  const formatSize = (bytes: number | null) => { if (!bytes) return ""; if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / 1048576).toFixed(1) + " MB"; };
  const timeAgo = (date: string) => { const diff = Date.now() - new Date(date).getTime(); const mins = Math.floor(diff / 60000); if (mins < 60) return mins + "m ago"; const hrs = Math.floor(diff / 3600000); if (hrs < 24) return hrs + "h ago"; return Math.floor(diff / 86400000) + "d ago"; };
  const scoreBg = (s: number | null) => s === null ? "bg-[var(--hm-text-tertiary)]" : s >= 75 ? "bg-[var(--hm-success)]" : s >= 50 ? "bg-[var(--hm-warning)]" : "bg-[var(--hm-danger)]";
  const scoreText = (s: number | null) => s === null ? "text-[var(--hm-text-tertiary)]" : s >= 75 ? "text-[var(--tag-green-fg)]" : s >= 50 ? "text-[var(--tag-yellow-fg)]" : "text-[var(--tag-red-fg)]";
  const scoreBorder = (s: number | null) => s === null ? "var(--hm-text-tertiary)" : s >= 75 ? "var(--hm-success)" : s >= 50 ? "var(--hm-warning)" : "var(--hm-danger)";
  const typeColor = (t: string) => { const c: Record<string, string> = { pdf: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]", pptx: "bg-[var(--tag-orange-bg)] text-[var(--tag-orange-fg)]", docx: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]", xlsx: "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]", mp4: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]", url: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]", jpg: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]", jpeg: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]", png: "bg-[var(--tag-pink-bg)] text-[var(--tag-pink-fg)]" }; return c[t] || "bg-[var(--tag-gray-bg)] text-[var(--tag-gray-fg)]"; };
  const isImage = (t: string) => ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(t);
  const hasActiveFilters = search || filterType || filterProduct || filterMarket || filterScore || filterScoreStatus;
  const clearFilters = () => { setSearch(""); setFilterType(""); setFilterProduct(""); setFilterMarket(""); setFilterScore(""); setFilterScoreStatus(""); setPage(1); setSelectedIds(new Set()); };
  const toggleSelect = (id: string, e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const allSelected = assets.length > 0 && assets.every(a => selectedIds.has(a.id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(assets.map(a => a.id)));
  const hasFile = fileRef.current !== null;
  const severityColor = (s: string) => s === "high" ? "text-[var(--tag-red-fg)] bg-[var(--tag-red-bg)] border-[var(--hm-border)]" : s === "medium" ? "text-[var(--tag-yellow-fg)] bg-[var(--tag-yellow-bg)] border-[var(--hm-border)]" : "text-[var(--tag-gray-fg)] bg-[var(--tag-gray-bg)] border-[var(--hm-border)]";
  const dimensionOrder = ["voice", "terminology", "messaging", "personality", "completeness"];

  // Ordered, capped tag list for compact/tile surfaces (product → market → persona → competitor)
  const assetTags = (a: Asset) => [
    ...a.productTags.map((t) => ({ t, cls: "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" })),
    ...a.marketTags.map((t) => ({ t, cls: "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)]" })),
    ...(a.personaTags || []).map((t) => ({ t, cls: "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]" })),
    ...(a.competitorTags || []).map((t) => ({ t, cls: "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" })),
  ];

  // Open file / Open source / Details — shared across list + compact rows
  const rowActions = (a: Asset) => (
    <div className="flex items-center gap-0.5 justify-end" onClick={(e) => e.stopPropagation()}>
      {a.fileUrl && (
        <a href={`/view/${a.id}`} target="_blank" rel="noopener" title="Open file" className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M7 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><path d="M10 2h4v4M14 2L8 8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      )}
      {a.sourceUrl && (
        <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" title="Open source file" className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--hm-link)] hover:bg-[var(--tag-blue-bg)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]">
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6.5 3.5H3.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.5 2.5h4v4M14 2l-6.5 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </a>
      )}
      <button onClick={() => openPanel(a)} title="Details" className="w-6 h-6 flex items-center justify-center rounded-md text-[var(--hm-text-secondary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]">
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );

  // Thumbnail + hover overlay (Open file / Source file), shared by tile + grouped
  const assetThumb = (a: Asset) => (
    a.fileUrl ? (
      <a href={`/view/${a.id}`} target="_blank" rel="noopener" className="block h-[80px] relative overflow-hidden cursor-pointer">
        <button onClick={(e) => toggleSelect(a.id, e)} title="Select" className={"absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all " + (selectedIds.has(a.id) ? "bg-[var(--hm-primary)] border-[var(--hm-primary)]" : "bg-[var(--hm-surface)]/80 border-white/50 opacity-0 group-hover:opacity-100")} style={{ backdropFilter: "blur(4px)" }}>
          {selectedIds.has(a.id) && <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </button>
        {isImage(a.fileType || "") ? (
          <img src={a.fileUrl} alt={a.name} className="w-full h-full object-cover object-left-top" />
        ) : (
          <div className="w-full h-full bg-[var(--hm-bg-secondary)] flex items-center justify-center">
            <div className={"w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-medium " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 4)}</div>
          </div>
        )}
        <span className="absolute top-2 text-[10px] px-2 py-0.5 bg-black/50 text-white rounded-md font-medium uppercase backdrop-blur-sm" style={{ left: "30px" }}>{a.fileType || "FILE"}</span>
        {a.brandScore === null && isAutoReviewing && <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] px-2 py-0.5 bg-[var(--tag-blue-fg)]/80 text-white rounded-md font-medium backdrop-blur-sm"><span className="w-2 h-2 border border-white/50 border-t-white rounded-full animate-spin inline-block shrink-0" />Analyzing</span>}
        <span className="absolute inset-0 transition-all flex items-center justify-center gap-2" style={{ background: "rgba(0,0,0,0)" }} onMouseEnter={(e) => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.45)"} onMouseLeave={(e) => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0)"}>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5" style={{ background: "#ffffff", color: "var(--hm-text)" }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M7 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" stroke="var(--hm-text)" strokeWidth="1.5" strokeLinecap="round" /><path d="M10 2h4v4M14 2L8 8" stroke="var(--hm-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Open file
          </span>
          {a.sourceUrl && <a href={a.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5" style={{ background: "var(--hm-primary)", color: "#ffffff" }}>
            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M6.5 3.5H3.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M9.5 2.5h4v4M14 2l-6.5 6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            Source file
          </a>}
        </span>
      </a>
    ) : (
      <div className="h-[80px] relative overflow-hidden">
        <div className="w-full h-full bg-[var(--hm-bg-secondary)] flex items-center justify-center">
          <div className={"w-10 h-10 rounded-xl flex items-center justify-center text-[12px] font-medium " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 4)}</div>
        </div>
        <span className="absolute top-2 text-[10px] px-2 py-0.5 bg-black/50 text-white rounded-md font-medium uppercase backdrop-blur-sm" style={{ left: "30px" }}>{a.fileType || "FILE"}</span>
        {a.brandScore === null && isAutoReviewing && <span className="absolute top-2 right-2 flex items-center gap-1 text-[10px] px-2 py-0.5 bg-[var(--tag-blue-fg)]/80 text-white rounded-md font-medium backdrop-blur-sm"><span className="w-2 h-2 border border-white/50 border-t-white rounded-full animate-spin inline-block shrink-0" />Analyzing</span>}
      </div>
    )
  );

  // Full tile card — shared by tile + grouped views
  const assetTile = (a: Asset) => {
    const tags = assetTags(a);
    const shown = tags.slice(0, 2);
    const overflow = tags.length - shown.length;
    return (
      <div key={a.id} className={"bg-[var(--hm-surface)] border rounded-xl overflow-hidden transition-all group " + (selectedIds.has(a.id) ? "border-[var(--hm-primary)] ring-2 ring-[var(--hm-link)]/30" : panelAsset?.id === a.id ? "border-[var(--hm-primary)] ring-1 ring-[var(--hm-link)]/20" : "border-[var(--hm-border)] hover:border-[var(--hm-primary)]/40")} style={{ boxShadow: "var(--hm-shadow-card)" }}>
        {assetThumb(a)}
        <div className="p-3">
          <p className="text-[13px] font-medium truncate">{a.name}</p>
          <div className="flex flex-wrap gap-1 mt-1.5 mb-1.5">
            {shown.map(({ t, cls }, i) => <span key={i} className={"text-[10px] px-1.5 py-0.5 rounded-md " + cls}>{t}</span>)}
            {overflow > 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)]" title={tags.slice(2).map((x) => x.t).join(", ")}>+{overflow}</span>}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[10px] text-[var(--hm-text-tertiary)]">{timeAgo(a.createdAt)}</p>
            <button onClick={(e) => { e.stopPropagation(); openPanel(a); }} className="text-[10px] text-[var(--hm-link)] hover:underline flex items-center gap-1">
              View details
              <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="var(--hm-primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ModuleTour moduleId="content-library" />

        <div className="px-4 md:px-7 py-4 bg-[var(--hm-surface)] border-b border-[var(--hm-border)] flex flex-wrap items-center justify-between gap-3" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
          <div className="min-w-0">
            <h1 className="text-[18px] md:text-[22px] font-semibold leading-tight">Asset library</h1>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">{totalCount || assets.length} asset{(totalCount || assets.length) !== 1 ? "s" : ""}{hasActiveFilters ? " (filtered)" : ""}{avgScore !== null ? " · Avg. score: " + avgScore + "%" : ""}</p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {assets.length > 0 && (
              <button
                onClick={runBatchAnalyze}
                disabled={batchAnalyzing}
                className="h-[34px] px-4 border border-[var(--hm-border)] text-[var(--hm-text-secondary)] rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:bg-[var(--tag-purple-bg)] active:scale-95 transition-all duration-150 disabled:opacity-50 flex-shrink-0"
                title="Extract learnings, metrics, and proof points from all assets into the knowledge base"
              >
                {batchAnalyzing ? (
                  <><span className="w-3 h-3 border-[1.5px] border-[var(--hm-border)] border-t-purple-600 rounded-full animate-spin" />Extracting intelligence...</>
                ) : (
                  <><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><rect x="3" y="8" width="2.5" height="5" rx="0.5" stroke="currentColor" strokeWidth="1.1" /><rect x="6.75" y="5" width="2.5" height="8" rx="0.5" stroke="currentColor" strokeWidth="1.1" /><rect x="10.5" y="2" width="2.5" height="11" rx="0.5" stroke="currentColor" strokeWidth="1.1" /></svg>Extract intelligence</>
                )}
              </button>
            )}
            <button data-tour="lib-upload" onClick={() => setShowUpload(true)} className="h-[34px] w-full sm:w-auto px-4 bg-[var(--hm-primary)] text-white rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90 active:opacity-100 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-2 flex-shrink-0" style={{ boxShadow: "0 1px 2px rgba(67,97,238,0.3)" }}>
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 4l3-3 3 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 13h12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
              Upload files
            </button>
          </div>
        </div>

        {/* Batch analysis result notification */}
        {batchResult && (
          <div className={`mx-4 md:mx-7 mt-3 px-4 py-2.5 rounded-lg text-[12px] font-medium flex items-center gap-2 animate-fade-in ${batchResult.analyzed > 0 ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)] border border-[var(--hm-border)]" : "bg-[var(--tag-yellow-bg)] text-[var(--tag-yellow-fg)] border border-[var(--hm-border)]"}`}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
            {batchResult.message} {batchResult.analyzed > 0 && "Learnings have been extracted and added to the knowledge base."}
          </div>
        )}

        {/* Content-type tab strip */}
        <div className="px-4 md:px-7 bg-[var(--hm-surface)] border-b border-[var(--hm-border)] flex items-center overflow-x-auto">
          {(
            [
              { value: "", label: "All" },
              { value: "deck", label: "Decks" },
              { value: "one_pager", label: "One-pagers" },
              { value: "case_study", label: "Case studies" },
              { value: "blog", label: "Blog posts" },
              { value: "brochure", label: "Brochures" },
              { value: "ebook", label: "Ebooks" },
              { value: "report", label: "Reports" },
            ] as { value: string; label: string }[]
          ).map((t) => (
            <button
              key={t.value}
              onClick={() => setFilterType(t.value)}
              className={
                "whitespace-nowrap border-b-2 px-4 py-2.5 text-[12px] transition-colors shrink-0 " +
                (filterType === t.value
                  ? "border-[var(--hm-primary)] font-semibold text-[var(--hm-text)]"
                  : "border-transparent text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:border-[var(--hm-border)]")
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="px-4 md:px-7 py-3 bg-[var(--hm-surface)] border-b border-[var(--hm-border)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto" data-tour="lib-search">
            <div className="relative flex-1 max-w-[240px]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", zIndex: 1 }}><circle cx="6.5" cy="6.5" r="5" stroke="#999" strokeWidth="1.1" /><path d="M14 14l-3-3" stroke="#999" strokeWidth="1.1" strokeLinecap="round" /></svg>
              <input type="text" placeholder="Search files, tags..." value={search} onChange={(e) => setSearch(e.target.value)} className="search-input" />
            </div>
            <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">All products</option>{[...new Set(products.map((p) => p.name))].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={filterMarket} onChange={(e) => setFilterMarket(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">All markets</option>{[...new Set(markets.map((m) => m.name))].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={filterScore} onChange={(e) => setFilterScore(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">Any score</option><option value="75+">75%+</option><option value="50-74">50-74%</option><option value="below60">Below 60%</option><option value="below50">Below 50%</option></select>
            <select value={filterScoreStatus} onChange={(e) => setFilterScoreStatus(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">Any status</option><option value="pending">Pending</option><option value="analyzed">Analyzed</option></select>
            {hasActiveFilters && <button onClick={clearFilters} className="text-[11px] text-[var(--hm-link)] hover:underline whitespace-nowrap transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-1">Clear</button>}
          </div>
          <div className="flex items-center gap-0.5 bg-[var(--hm-bg-secondary)] rounded-lg p-0.5 flex-shrink-0">
            <button onClick={() => setView("tile")} title="Tile view" className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (view === "tile" ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-surface)]/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke={view === "tile" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" /><rect x="9" y="1" width="6" height="6" rx="1" stroke={view === "tile" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" /><rect x="1" y="9" width="6" height="6" rx="1" stroke={view === "tile" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" /><rect x="9" y="9" width="6" height="6" rx="1" stroke={view === "tile" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" /></svg></button>
            <button onClick={() => setView("list")} title="List view" className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (view === "list" ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-surface)]/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke={view === "list" ? "var(--hm-primary)" : "#999"} strokeWidth="1.2" strokeLinecap="round" /></svg></button>
            <button onClick={() => setView("grouped")} title="Grouped by product" className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (view === "grouped" ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-surface)]/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M1 4.5h5.5l1 1.5H15v7H1V4.5z" stroke={view === "grouped" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" strokeLinejoin="round" /><path d="M1 7.5h14" stroke={view === "grouped" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" /></svg></button>
            <button onClick={() => setView("compact")} title="Compact view" className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (view === "compact" ? "bg-[var(--hm-surface)]" : "hover:bg-[var(--hm-surface)]/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h12" stroke={view === "compact" ? "var(--hm-primary)" : "#999"} strokeWidth="1.1" strokeLinecap="round" /></svg></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Main scrollable area */}
          <div ref={scrollContainerRef} data-tour="lib-grid" className="flex-1 overflow-y-auto p-4 md:p-7">

            {/* Upload */}
            {showUpload && (
              <div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl p-6 mb-5 animate-fade-in">
                <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-medium">Upload content</h3><button onClick={resetUpload} className="opacity-40 hover:opacity-100 transition-opacity duration-150 text-lg leading-none w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--hm-bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]">&times;</button></div>
                {!uploadName ? (
                  <div>
                    <label className="block" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFileSelect(f); }}>
                      <div className={"border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all " + (dragOver ? "border-[var(--hm-primary)] bg-[var(--tag-blue-bg)]/50" : "border-[var(--hm-border)] hover:border-[var(--hm-primary)] hover:bg-[var(--tag-blue-bg)]/30")}>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 opacity-30"><path d="M12 5v14M5 12l7-7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <p className="text-[14px] font-medium mb-1">Drag & drop files here</p>
                        <p className="text-[12px] text-[var(--hm-text-tertiary)]">or click to browse</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-2 leading-relaxed">PDF, PPTX, DOCX, XLSX, MP4, images</p>
                      </div>
                      <input type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.mp4,.jpg,.jpeg,.png,.svg,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
                    </label>
                    <div className="flex items-center gap-3 mt-3"><div className="flex-1 h-px bg-[var(--hm-border)]" /><span className="text-[11px] text-[var(--hm-text-tertiary)]">or</span><div className="flex-1 h-px bg-[var(--hm-border)]" /></div>
                    <button onClick={() => { fileRef.current = null; setUploadName("New Asset"); }} className="w-full mt-3 h-9 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-primary)]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-1">Add manually</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-[var(--hm-bg-secondary)] rounded-lg">
                      <div className={"w-10 h-10 rounded-lg flex items-center justify-center text-[11px] font-medium " + typeColor(uploadType)}>{uploadType.toUpperCase().slice(0, 4)}</div>
                      <div className="flex-1"><p className="text-[13px] font-medium">{hasFile ? fileRef.current!.name : uploadName}</p><p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{hasFile ? formatSize(fileRef.current!.size) + " — " : ""}.{uploadType} {hasFile ? <span className="text-[var(--tag-green-fg)]">&#10003; Attached</span> : <span className="text-[var(--tag-yellow-fg)]">Metadata only</span>}</p></div>
                      <button onClick={() => { fileRef.current = null; setUploadName(""); }} className="text-[11px] text-[var(--hm-link)] hover:underline">Change</button>
                    </div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Asset name *</label><input type="text" value={uploadName} onChange={(e) => setUploadName(e.target.value)} className="text-[13px]" /></div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">File type</label><select value={uploadType} onChange={(e) => setUploadType(e.target.value)} style={{ fontSize: "12px" }}><option value="pdf">PDF</option><option value="pptx">PPTX</option><option value="docx">DOCX</option><option value="xlsx">XLSX</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="mp4">MP4</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Content type</label><select value={uploadContentType} onChange={(e) => setUploadContentType(e.target.value)} style={{ fontSize: "12px" }}><option value="deck">Deck</option><option value="one_pager">One-pager</option><option value="case_study">Case Study</option><option value="blog">Blog Post</option><option value="brochure">Brochure</option><option value="ebook">Ebook</option><option value="report">Report</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Product</label><select value={uploadProduct} onChange={(e) => setUploadProduct(e.target.value)} style={{ fontSize: "12px" }}><option value="">All</option>{products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Market</label><select value={uploadMarket} onChange={(e) => setUploadMarket(e.target.value)} style={{ fontSize: "12px" }}><option value="">Global</option>{markets.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select></div>
                    </div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Source file URL <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span></label><input type="url" value={uploadSourceUrl} onChange={(e) => setUploadSourceUrl(e.target.value)} placeholder="Canva, Google Drive, Figma link..." className="text-[13px]" /></div>
                    {uploadError && <p className="text-[12px] text-[var(--tag-red-fg)] bg-[var(--tag-red-bg)] border border-[var(--hm-border)] rounded-lg px-3 py-2">{uploadError}</p>}
                    {duplicateWarning && (
                      <div className="p-3 bg-[var(--tag-yellow-bg)] border border-[var(--hm-border)] rounded-lg">
                        <div className="flex items-start gap-2 mb-2">
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="mt-0.5 flex-shrink-0"><path d="M8 1.5l6.5 12H1.5L8 1.5z" stroke="var(--hm-warning)" strokeWidth="1.2" fill="var(--tag-yellow-bg)"/><path d="M8 6v3M8 11h.01" stroke="var(--hm-warning)" strokeWidth="1.3" strokeLinecap="round"/></svg>
                          <div>
                            <p className="text-[12px] font-medium text-[var(--tag-yellow-fg)]">Duplicate file detected</p>
                            {duplicateWarning.duplicates.map((d, i) => (
                              <p key={i} className="text-[11px] text-[var(--tag-yellow-fg)] mt-1">
                                This file was already uploaded as &ldquo;<span className="font-medium">{d.existingName}</span>&rdquo; on {new Date(d.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}.
                              </p>
                            ))}
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end mt-2">
                          <button onClick={() => setDuplicateWarning(null)} className="h-7 px-3 border border-[var(--hm-border)] rounded-md text-[11px] text-[var(--tag-yellow-fg)] hover:bg-[var(--tag-yellow-bg)] transition-colors">Cancel</button>
                          <button onClick={forceSaveDuplicate} disabled={uploading} className="h-7 px-3 bg-[var(--hm-warning)] text-white rounded-md text-[11px] font-medium hover:bg-[var(--hm-warning)] transition-colors disabled:opacity-50">Upload anyway</button>
                        </div>
                      </div>
                    )}
                    {!duplicateWarning && (
                    <div className="flex justify-between items-center pt-2">
                      {uploadProgress && <p className="text-[11px] text-[var(--hm-text)] flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-[var(--hm-primary)]/30 border-t-[var(--hm-primary)] rounded-full animate-spin inline-block" />{uploadProgress}</p>}
                      <div className="flex gap-2 ml-auto"><button onClick={resetUpload} className="h-[34px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-primary)]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-1">Cancel</button><button onClick={handleUpload} disabled={uploading || !uploadName.trim()} className="h-[34px] px-5 bg-[var(--hm-primary)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-2">{uploading ? "Uploading..." : "Upload"}</button></div>
                    </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="mb-4 flex items-center gap-3 px-4 py-2.5 bg-[var(--hm-primary)]/5 border border-[var(--hm-primary)]/20 rounded-xl">
                <span className="text-[12px] font-medium text-[var(--hm-text)]">{selectedIds.size} selected</span>
                <div className="flex-1" />
                <button onClick={toggleSelectAll} className="text-[11px] text-[var(--hm-link)] hover:underline px-2 py-1 rounded-lg hover:bg-[var(--tag-blue-bg)]">{allSelected ? "Deselect all" : "Select all"}</button>
                <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] px-2 py-1 rounded-lg hover:bg-[var(--hm-bg-secondary)]">Clear</button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
                    await Promise.all([...selectedIds].map(id => fetch("/api/content-library/manage?id=" + id, { method: "DELETE" })));
                    setSelectedIds(new Set());
                    fetchData();
                  }}
                  className="h-7 px-3 bg-[var(--hm-danger)] text-white rounded-lg text-[11px] font-medium hover:bg-[var(--hm-danger)] flex items-center gap-1.5"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8L13 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Delete {selectedIds.size}
                </button>
              </div>
            )}

            {/* Skeleton loading */}
            {loading && assets.length === 0 && (
              <div className={view === "tile" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" : "bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-hidden"}>
                {view === "tile" ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-hidden animate-pulse">
                    <div className="h-[110px] bg-[var(--hm-bg-secondary)]" />
                    <div className="p-3.5 space-y-2">
                      <div className="h-3 bg-[var(--hm-bg-secondary)] rounded w-3/4" />
                      <div className="h-2.5 bg-[var(--hm-bg-secondary)] rounded w-1/2" />
                      <div className="h-2 bg-[var(--hm-bg-secondary)] rounded w-1/3 mt-1" />
                    </div>
                  </div>
                )) : Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-[2fr_80px_80px_70px_55px_70px_60px] gap-2 px-4 py-3 border-b border-[var(--hm-border)] last:border-b-0 items-center animate-pulse">
                    <div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-md bg-[var(--hm-bg-secondary)] flex-shrink-0" /><div className="h-3 bg-[var(--hm-bg-secondary)] rounded w-2/3" /></div>
                    {Array.from({ length: 6 }).map((_, j) => <div key={j} className="h-2.5 bg-[var(--hm-bg-secondary)] rounded" />)}
                  </div>
                ))}
              </div>
            )}

            {/* Error state */}
            {!loading && fetchError && (<div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl p-14 text-center"><div className="w-14 h-14 rounded-full bg-[var(--tag-red-bg)] flex items-center justify-center mx-auto mb-4"><svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM8 5v3M8 10h.01" stroke="var(--hm-danger)" strokeWidth="1.3" strokeLinecap="round" /></svg></div><p className="text-[15px] font-medium mb-1.5">Failed to load assets</p><p className="text-[13px] text-[var(--hm-text-tertiary)] mb-5 max-w-[300px] mx-auto leading-relaxed">There was a problem fetching your content library. Please try again.</p><button onClick={() => fetchData()} className="h-10 px-6 bg-[var(--hm-primary)] text-white rounded-lg text-[13px] font-medium hover:opacity-90">Retry</button></div>)}

            {/* Empty state */}
            {!loading && !fetchError && assets.length === 0 && !showUpload && (
              <div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl p-14 text-center">
                <div className="w-14 h-14 rounded-full bg-[var(--hm-bg-secondary)] flex items-center justify-center mx-auto mb-4"><svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M12 5v9H4V2h5l3 3z" stroke="#999" strokeWidth="1" /></svg></div>
                <p className="text-[15px] font-medium mb-1.5">{hasActiveFilters ? "No matching assets" : "No content yet"}</p>
                <p className="text-[13px] text-[var(--hm-text-tertiary)] mb-5 max-w-[300px] mx-auto leading-relaxed">{hasActiveFilters ? "Try adjusting your filters." : "Upload assets to get brand compliance scores."}</p>
                {hasActiveFilters ? <button onClick={clearFilters} className="h-10 px-6 border border-[var(--hm-border)] rounded-lg text-[13px]">Clear filters</button> : <button onClick={() => setShowUpload(true)} className="h-10 px-6 bg-[var(--hm-primary)] text-white rounded-lg text-[13px] font-medium">Upload your first file</button>}
              </div>
            )}

            {/* Tile view */}
            {assets.length > 0 && view === "tile" && (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                {assets.map((a) => assetTile(a))}
              </div>
            )}

            {/* List view */}
            {assets.length > 0 && view === "list" && (
              <div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-x-auto">
                <div className="grid grid-cols-[28px_minmax(0,2fr)_84px_78px_68px_50px_78px_92px] gap-2 px-4 py-2.5 border-b border-[var(--hm-border)] text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium min-w-[640px]">
                  <button onClick={toggleSelectAll} title={allSelected ? "Deselect all" : "Select all"} className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 " + (allSelected ? "bg-[var(--hm-primary)] border-[var(--hm-primary)]" : "border-[var(--hm-border)] hover:border-[var(--hm-primary)]")}>{allSelected && <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>
                  <span>Name</span><span>Type</span><span>Product</span><span>Market</span><span>Score</span><span>Status</span><span className="text-right">Actions</span>
                </div>
                {assets.map((a) => (
                  <div key={a.id} className={"grid grid-cols-[28px_minmax(0,2fr)_84px_78px_68px_50px_78px_92px] gap-2 px-4 py-2 border-b border-[var(--hm-border)] items-center last:border-b-0 group min-w-[640px] " + (selectedIds.has(a.id) ? "bg-[var(--tag-blue-bg)]/40" : panelAsset?.id === a.id ? "bg-[var(--tag-blue-bg)]/30" : "hover:bg-[var(--hm-bg-secondary)]")}>
                    <button onClick={(e) => toggleSelect(a.id, e)} title="Select" className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 opacity-0 group-hover:opacity-100 " + (selectedIds.has(a.id) ? "!opacity-100 bg-[var(--hm-primary)] border-[var(--hm-primary)]" : "border-[var(--hm-border)] hover:border-[var(--hm-primary)]")}>{selectedIds.has(a.id) && <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>
                    {a.fileUrl ? (
                      <a href={`/view/${a.id}`} target="_blank" rel="noopener" className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                        <div className={"w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-medium flex-shrink-0 " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 3)}</div>
                        <span className="text-[12px] font-medium truncate hover:text-[var(--hm-link)] hover:underline">{a.name}</span>
                      </a>
                    ) : (
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={"w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-medium flex-shrink-0 " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 3)}</div>
                        <span className="text-[12px] font-medium truncate">{a.name}</span>
                      </div>
                    )}
                    <span className="text-[11px] text-[var(--hm-text-secondary)] capitalize truncate">{(a.contentType || "").replace(/_/g, " ")}</span>
                    <span className="text-[11px] text-[var(--hm-text-secondary)] truncate">{a.productTags[0] || "All"}</span>
                    <span className="text-[11px] text-[var(--hm-text-secondary)] truncate">{a.marketTags[0] || "Global"}</span>
                    <span className={"text-[11px] font-medium " + scoreText(a.brandScore)}>{a.brandScore !== null ? Math.round(a.brandScore) + "%" : "—"}</span>
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-medium flex items-center gap-1 truncate " + (a.scoreStatus === "analyzed" ? "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]" : a.brandScore !== null ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : isAutoReviewing ? "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" : "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]")}>
                        {isAutoReviewing && a.scoreStatus === "pending" && <span className="w-2 h-2 border border-[var(--hm-border)]/50 border-t-blue-600 rounded-full animate-spin inline-block shrink-0" />}
                        {a.scoreStatus === "analyzed" ? "Reviewed" : a.brandScore !== null ? "Scored" : isAutoReviewing ? "Analyzing…" : "Pending"}
                      </span>
                      <span title={a.intelligenceStatus === "done" ? "Intelligence extracted" : a.intelligenceStatus === "extracting" ? "Extracting intelligence…" : a.intelligenceStatus === "failed" ? "Extraction failed" : "Intelligence not extracted"} className={"w-4 h-4 rounded flex items-center justify-center flex-shrink-0 " + (a.intelligenceStatus === "done" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : a.intelligenceStatus === "extracting" ? "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" : a.intelligenceStatus === "failed" ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" : "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]")}>
                        {a.intelligenceStatus === "extracting" ? <span className="w-2 h-2 border border-[var(--hm-border)]/50 border-t-blue-600 rounded-full animate-spin inline-block shrink-0" /> : <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.4 3.2L13 6.5l-2.6 2.5.5 3.5L8 11l-2.9 1.5.5-3.5L3 6.5l3.6-1.3L8 2z" stroke="currentColor" strokeWidth="1" fill="none" strokeLinejoin="round" /></svg>}
                      </span>
                    </div>
                    {rowActions(a)}
                  </div>
                ))}
              </div>
            )}

            {/* Grouped view */}
            {assets.length > 0 && view === "grouped" && (() => {
              // Group by first product tag, or "General" if untagged
              const groupOrder: string[] = [];
              const groups: Record<string, Asset[]> = {};
              for (const a of assets) {
                const key = a.productTags[0] || "General";
                if (!groups[key]) { groups[key] = []; groupOrder.push(key); }
                groups[key].push(a);
              }
              const toggleGroup = (group: string) => setCollapsedGroups(prev => {
                const next = new Set(prev);
                if (next.has(group)) next.delete(group); else next.add(group);
                return next;
              });
              return (
                <div className="space-y-5">
                  {groupOrder.map((group) => {
                    const items = groups[group];
                    const isCollapsed = collapsedGroups.has(group);
                    const scoredItems = items.filter(a => a.brandScore !== null);
                    const avgGroupScore = scoredItems.length > 0
                      ? Math.round(scoredItems.reduce((s, a) => s + a.brandScore!, 0) / scoredItems.length)
                      : null;
                    return (
                      <div key={group}>
                        <button
                          onClick={() => toggleGroup(group)}
                          className="w-full flex items-center gap-2.5 mb-3 group/hdr"
                        >
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={"shrink-0 transition-transform duration-150 " + (isCollapsed ? "" : "rotate-90")}><path d="M6 4l4 4-4 4" stroke="var(--hm-primary)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                          <span className="text-[13px] font-semibold text-[var(--hm-text)]">{group}</span>
                          <span className="text-[11px] text-[var(--hm-text-tertiary)]">{items.length} asset{items.length !== 1 ? "s" : ""}</span>
                          {avgGroupScore !== null && (
                            <span className={"text-[10px] px-2 py-0.5 rounded-full font-semibold text-white shrink-0 " + scoreBg(avgGroupScore)}>
                              avg {avgGroupScore}%
                            </span>
                          )}
                          <div className="flex-1 h-px bg-[var(--hm-border)]" />
                        </button>
                        {!isCollapsed && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                            {items.map((a) => assetTile(a))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* Compact view */}
            {assets.length > 0 && view === "compact" && (
              <div className="bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-xl overflow-x-auto">
                {assets.map((a) => {
                  const sc = scoreBg(a.brandScore);
                  return (
                    <div key={a.id} className={"grid grid-cols-[24px_38px_minmax(0,1fr)_96px_58px_60px_96px] gap-2 px-3 h-[34px] items-center border-b border-[var(--hm-border)] last:border-b-0 group min-w-[560px] " + (selectedIds.has(a.id) ? "bg-[var(--tag-blue-bg)]/40" : panelAsset?.id === a.id ? "bg-[var(--tag-blue-bg)]/30" : "hover:bg-[var(--hm-bg-secondary)]")}>
                      <button onClick={(e) => toggleSelect(a.id, e)} title="Select" className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 opacity-0 group-hover:opacity-100 " + (selectedIds.has(a.id) ? "!opacity-100 bg-[var(--hm-primary)] border-[var(--hm-primary)]" : "border-[var(--hm-border)] hover:border-[var(--hm-primary)]")}>{selectedIds.has(a.id) && <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>
                      <span className={"text-[9px] font-medium px-1 py-0.5 rounded text-center " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 4)}</span>
                      {a.fileUrl ? (
                        <a href={`/view/${a.id}`} target="_blank" rel="noopener" className="text-[12px] font-medium truncate hover:text-[var(--hm-link)] hover:underline min-w-0">{a.name}</a>
                      ) : (
                        <span className="text-[12px] font-medium truncate min-w-0">{a.name}</span>
                      )}
                      <span className="text-[11px] text-[var(--hm-text-secondary)] truncate">{a.productTags[0] || "All"}</span>
                      <span className="flex items-center gap-1.5">
                        {a.brandScore !== null ? <><span className={"w-1.5 h-1.5 rounded-full flex-shrink-0 " + sc} /><span className={"text-[11px] font-medium " + scoreText(a.brandScore)}>{Math.round(a.brandScore)}%</span></> : <span className="text-[11px] text-[var(--hm-text-tertiary)]">—</span>}
                      </span>
                      <span className="text-[10px] text-[var(--hm-text-tertiary)] truncate">{timeAgo(a.createdAt)}</span>
                      {rowActions(a)}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Infinite scroll sentinel */}
            <div ref={sentinelRef} className="h-1" />
            {loadingMore && (
              <div className="mt-4 flex items-center justify-center gap-2 py-4">
                <div className="w-4 h-4 border-2 border-[var(--hm-primary)]/30 border-t-[var(--hm-primary)] rounded-full animate-spin" />
                <span className="text-[12px] text-[var(--hm-text-tertiary)]">Loading more...</span>
              </div>
            )}
            {!hasMore && assets.length > 0 && !loading && (
              <p className="mt-4 text-center text-[12px] text-[var(--hm-text-tertiary)] py-2">All assets loaded</p>
            )}
          </div>

          {/* Right-side detail panel */}
          {panelAsset && (
            <div className="w-full sm:w-[360px] md:w-[400px] flex-shrink-0 bg-[var(--hm-surface)] border-t sm:border-t-0 sm:border-l border-[var(--hm-border)] flex flex-col h-full overflow-hidden">

              {/* Panel header */}
              <div className="px-5 py-3.5 border-b border-[var(--hm-border)] flex items-start justify-between flex-shrink-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className={"w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-medium flex-shrink-0 " + typeColor(panelAsset.fileType || "")}>{(panelAsset.fileType || "?").toUpperCase().slice(0, 4)}</div>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium truncate">{panelAsset.name}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)]">{(panelAsset.fileType || "").toUpperCase()} {panelAsset.fileSize ? "· " + formatSize(panelAsset.fileSize) : ""} · {timeAgo(panelAsset.createdAt)}</p>
                    {(panelAsset.contentType || panelAsset.productTags.length > 0 || panelAsset.marketTags.length > 0) && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {panelAsset.contentType && <span className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md capitalize">{panelAsset.contentType.replace(/_/g, " ")}</span>}
                        {panelAsset.productTags.map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--tag-blue-bg)] text-[var(--hm-text)] rounded-md">{t}</span>)}
                        {panelAsset.marketTags.map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{t}</span>)}
                        {(panelAsset.personaTags || []).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)] rounded-md">{t}</span>)}
                        {(panelAsset.competitorTags || []).map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] rounded-md">{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={closePanel} className="text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)]">&times;</button>
              </div>

              {/* Tab bar */}
              <div className="flex border-b border-[var(--hm-border)] flex-shrink-0">
                <button onClick={() => setPanelTab("score")} className={"flex-1 py-2.5 text-[12px] border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (panelTab === "score" ? "font-medium text-[var(--hm-text)] border-[var(--hm-primary)]" : "text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)]")}>Brand score</button>
                <button onClick={() => setPanelTab("edit")} className={"flex-1 py-2.5 text-[12px] border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (panelTab === "edit" ? "font-medium text-[var(--hm-text)] border-[var(--hm-primary)]" : "text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)]")}>Edit details</button>
              </div>

              {/* Source file banner (visible in both tabs) */}
              {panelAsset.sourceUrl && (
                <div className="px-5 py-2.5 border-b border-[var(--hm-border)] bg-[var(--tag-blue-bg)]/50 flex-shrink-0">
                  <a href={panelAsset.sourceUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[12px] text-[var(--hm-link)] hover:underline font-medium">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0"><path d="M6.5 3.5H3.5a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M9.5 2.5h4v4M14 2l-6.5 6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Open source file
                    <span className="text-[10px] font-normal text-[var(--hm-text-tertiary)] truncate ml-auto max-w-[160px]">{panelAsset.sourceUrl.replace(/^https?:\/\//, '').split('/')[0]}</span>
                  </a>
                </div>
              )}

              {/* Score tab */}
              {panelTab === "score" && (
                <div className="flex-1 overflow-y-auto">

                  {/* Score gauge */}
                  <div className="px-5 py-5 border-b border-[var(--hm-border)]">
                    <div className="flex items-center gap-5">
                      <div className="relative w-[80px] h-[80px] flex-shrink-0">
                        <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
                          <circle cx="40" cy="40" r="34" fill="none" stroke="var(--hm-border)" strokeWidth="7" />
                          <circle cx="40" cy="40" r="34" fill="none"
                            stroke={scoreBorder(panelAsset.brandScore)}
                            strokeWidth="7"
                            strokeDasharray={`${(panelAsset.brandScore ?? 0) / 100 * 213.6} 213.6`}
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className={"text-[18px] font-semibold " + scoreText(panelAsset.brandScore)}>
                            {panelAsset.brandScore !== null ? Math.round(panelAsset.brandScore) : "—"}
                          </span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-[13px] font-medium">Brand score</p>
                          <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-medium " + (panelAsset.scoreStatus === "analyzed" ? "bg-[var(--tag-purple-bg)] text-[var(--tag-purple-fg)]" : panelAsset.brandScore !== null ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]")}>{panelAsset.scoreStatus === "analyzed" ? "AI Reviewed" : panelAsset.brandScore !== null ? "Auto-scored" : "Pending analysis"}</span>
                        </div>
                        {panelAsset.aiSummary ? (
                          <p className="text-[11px] text-[var(--hm-text-secondary)] leading-relaxed">{panelAsset.aiSummary}</p>
                        ) : (
                          <p className="text-[11px] text-[var(--hm-text-tertiary)]">Run a brand review to get AI-powered section analysis and improvement suggestions.</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Intelligence extraction status */}
                  <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <p className="text-[13px] font-medium">Intelligence extraction</p>
                        <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-medium " + (panelAsset.intelligenceStatus === "done" ? "bg-[var(--tag-green-bg)] text-[var(--tag-green-fg)]" : panelAsset.intelligenceStatus === "extracting" ? "bg-[var(--tag-blue-bg)] text-[var(--tag-blue-fg)]" : panelAsset.intelligenceStatus === "failed" ? "bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)]" : "bg-[var(--hm-bg-tertiary)] text-[var(--hm-text-tertiary)]")}>
                          {panelAsset.intelligenceStatus === "done" ? "Complete" : panelAsset.intelligenceStatus === "extracting" ? "In progress…" : panelAsset.intelligenceStatus === "failed" ? "Failed" : "Not started"}
                        </span>
                      </div>
                      {panelAsset.analyzedAt && (
                        <span className="text-[10px] text-[var(--hm-text-tertiary)]">
                          {new Date(panelAsset.analyzedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at {new Date(panelAsset.analyzedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">
                      {panelAsset.intelligenceStatus === "done"
                        ? "Learnings, proof points, and metrics have been extracted into the knowledge base."
                        : panelAsset.intelligenceStatus === "failed"
                          ? "Extraction failed — click \"Extract intelligence\" to retry."
                          : panelAsset.intelligenceStatus === "extracting"
                            ? "AI is analyzing this asset and extracting learnings…"
                            : "Click \"Extract intelligence\" to extract learnings, metrics, and proof points."}
                    </p>
                  </div>

                  {/* Dimension bars */}
                  {(panelAsset.scoreVoice !== null || panelAsset.scoreTerminology !== null) && (
                    <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                      <p className="text-[10px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wide mb-3">Dimension breakdown</p>
                      <div className="space-y-3">
                        {dimensionOrder.map((dim) => {
                          const dimMap: Record<string, keyof Asset> = {
                            voice: "scoreVoice", terminology: "scoreTerminology",
                            messaging: "scoreMessaging", personality: "scorePersonality", completeness: "scoreCompleteness",
                          };
                          const labelMap: Record<string, string> = {
                            voice: "Voice & Tone", terminology: "Terminology",
                            messaging: "Messaging", personality: "Personality", completeness: "Completeness",
                          };
                          const val = panelAsset[dimMap[dim]] as number | null;
                          if (val === null) return null;
                          const reviewDim = brandReview?.dimensions?.[dim];
                          return (
                            <div key={dim}>
                              <div className="flex justify-between items-center mb-1">
                                <span className="text-[11px] text-[var(--hm-text)]">{labelMap[dim]}</span>
                                <span className={"text-[11px] font-medium " + scoreText(val)}>{val}%</span>
                              </div>
                              <div className="w-full h-[8px] rounded-full bg-[var(--hm-border)] overflow-hidden">
                                <div className={"h-full rounded-full transition-all " + scoreBg(val)} style={{ width: val + "%" }} />
                              </div>
                              {reviewDim?.assessment && (
                                <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1">{reviewDim.assessment}</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Priority fixes */}
                  {panelAsset.scoreSuggestions?.length > 0 && (
                    <div className="px-5 py-4 border-b border-[var(--hm-border)]">
                      <p className="text-[10px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wide mb-3">Priority improvements</p>
                      <div className="space-y-2">
                        {panelAsset.scoreSuggestions.map((fix, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <span className="w-4 h-4 rounded-full bg-[var(--hm-primary)] text-white text-[9px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                            <p className="text-[11px] text-[var(--hm-text-secondary)] leading-relaxed">{fix}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Flagged sections (from full review) */}
                  {reviewLoading && (
                    <div className="px-5 py-8 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[var(--hm-primary)]/30 border-t-[var(--hm-primary)] rounded-full animate-spin" />
                      <span className="text-[12px] text-[var(--hm-text-tertiary)]">Loading review…</span>
                    </div>
                  )}

                  {brandReview && brandReview.sections?.length > 0 && (
                    <div className="px-5 py-4">
                      <p className="text-[10px] font-medium text-[var(--hm-text-secondary)] uppercase tracking-wide mb-3">
                        Flagged sections ({brandReview.sections.length})
                      </p>
                      <div className="space-y-2.5">
                        {brandReview.sections.map((section, i) => (
                          <div key={i} className={"border rounded-xl overflow-hidden " + (section.severity === "high" ? "border-[var(--hm-border)] border-l-[3px] border-l-red-500" : section.severity === "medium" ? "border-[var(--hm-border)] border-l-[3px] border-l-amber-500" : "border-[var(--hm-border)] border-l-[3px] border-l-gray-300")}>
                            {/* Section header */}
                            <button
                              onClick={() => setExpandedSection(expandedSection === i ? null : i)}
                              className="w-full flex items-start gap-2.5 p-3 hover:bg-[var(--hm-bg-secondary)] transition-colors text-left"
                            >
                              <span className={"text-[10px] px-2 py-0.5 rounded-md border font-semibold flex-shrink-0 mt-0.5 capitalize " + severityColor(section.severity)}>{section.severity}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-[11px] italic text-[var(--hm-text-tertiary)] truncate">"{section.excerpt}"</p>
                                <p className="text-[11px] text-[var(--hm-text)] mt-0.5 truncate">{section.issue}</p>
                              </div>
                              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className={"flex-shrink-0 mt-0.5 transition-transform " + (expandedSection === i ? "rotate-180" : "")}><path d="M4 6l4 4 4-4" stroke="#999" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            </button>

                            {/* Expanded content */}
                            {expandedSection === i && (
                              <div className="px-3 pb-3 border-t border-[var(--hm-border)] bg-[var(--hm-bg-secondary)]">
                                <div className="mt-3 space-y-3">
                                  <div>
                                    <p className="text-[9px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-1">Original excerpt</p>
                                    <p className="text-[11px] italic text-[var(--hm-text-secondary)] bg-[var(--hm-surface)] border border-[var(--hm-border)] rounded-lg px-2.5 py-2 leading-relaxed">"{section.excerpt}"</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-1">Issue</p>
                                    <p className="text-[11px] text-[var(--hm-text)] leading-relaxed">{section.issue}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-1">Suggested improvement</p>
                                    <p className="text-[11px] text-[var(--hm-text)] leading-relaxed rounded-lg px-2.5 py-2" style={{ background: "color-mix(in srgb, var(--hm-success) 12%, var(--hm-surface))", border: "1px solid color-mix(in srgb, var(--hm-success) 30%, var(--hm-border))" }}>{section.suggestion}</p>
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[9px] text-[var(--hm-text-tertiary)]">Dimension:</span>
                                    <span className="text-[9px] px-1.5 py-0.5 rounded-md capitalize" style={{ background: "var(--hm-accent-light)", color: "var(--hm-accent)" }}>{section.dimension}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Running review loading state — shown while POST is in flight */}
                  {runningReview && (
                    <div className="px-5 py-10 flex flex-col items-center justify-center gap-3 text-center">
                      <div className="w-10 h-10 rounded-full bg-[var(--hm-bg-tertiary)] flex items-center justify-center">
                        <LogoLoader size={34} />
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-[var(--hm-text)]">Analyzing brand compliance…</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">This can take 10–30 seconds</p>
                      </div>
                      <div className="w-full max-w-[180px] h-1 bg-[var(--hm-border)] rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-[var(--hm-primary)] rounded-full animate-pulse" style={{ width: "60%" }} />
                      </div>
                    </div>
                  )}

                  {/* CTA to run review */}
                  {!reviewLoading && !brandReview && !runningReview && (
                    <div className="px-5 py-6">
                      <div className="bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] rounded-xl p-4 text-center">
                        <div className="w-8 h-8 rounded-full bg-[var(--hm-primary)] flex items-center justify-center mx-auto mb-3">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3.5L13 6.5l-2.5 2.5.5 3.5L8 11l-3 1.5.5-3.5L3 6.5l3.5-1L8 2z" stroke="white" strokeWidth="1.1" fill="none" strokeLinejoin="round" /></svg>
                        </div>
                        <p className="text-[12px] font-medium mb-1">AI brand review</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-4 leading-relaxed">Get section-by-section brand analysis with specific improvement suggestions for each flagged passage.</p>
                        <button
                          onClick={runBrandReview}
                          className="h-[34px] px-5 bg-[var(--hm-primary)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 flex items-center gap-2 mx-auto"
                        >
                          Run brand review
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Re-run button when review exists */}
                  {!reviewLoading && brandReview && !runningReview && (
                    <div className="px-5 py-4 border-t border-[var(--hm-border)]">
                      <button
                        onClick={runBrandReview}
                        className="w-full h-[34px] border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:border-[var(--hm-primary)] hover:text-[var(--hm-text)] transition-colors flex items-center justify-center gap-2"
                      >
                        Re-run brand review
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Edit tab */}
              {panelTab === "edit" && (
                <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Asset name</label>
                    <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="text-[13px]" />
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Content type</label>
                    <select value={editContentType} onChange={(e) => setEditContentType(e.target.value)} style={{ fontSize: "12px" }}>
                      <option value="deck">Deck</option><option value="one_pager">One-pager</option><option value="case_study">Case Study</option>
                      <option value="blog">Blog Post</option><option value="brochure">Brochure</option><option value="ebook">Ebook</option><option value="report">Report</option><option value="video">Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Product tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {products.map((p) => { const sel = editProductTags.includes(p.name); return <button key={p.name} type="button" onClick={() => setEditProductTags(sel ? editProductTags.filter(x => x !== p.name) : [...editProductTags, p.name])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (sel ? "border-[var(--hm-primary)] bg-[var(--tag-blue-bg)] text-[var(--hm-text)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[var(--hm-primary)]/50 hover:text-[var(--hm-text)]")}>{p.name}</button>; })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Market tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {markets.map((m) => { const sel = editMarketTags.includes(m.name); return <button key={m.name} type="button" onClick={() => setEditMarketTags(sel ? editMarketTags.filter(x => x !== m.name) : [...editMarketTags, m.name])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] " + (sel ? "border-[var(--hm-primary)] bg-[var(--tag-blue-bg)] text-[var(--hm-text)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[var(--hm-primary)]/50 hover:text-[var(--hm-text)]")}>{m.name}</button>; })}
                    </div>
                  </div>
                  {personas.length > 0 && <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Persona tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {personas.map((p) => { const sel = editPersonaTags.includes(p.title); return <button key={p.title} type="button" onClick={() => setEditPersonaTags(sel ? editPersonaTags.filter(x => x !== p.title) : [...editPersonaTags, p.title])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-primary)] " + (sel ? "border-[var(--hm-primary)] bg-[var(--tag-purple-bg)] text-[var(--hm-primary)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[var(--hm-primary)]/50 hover:text-[var(--hm-primary)]")}>{p.title}</button>; })}
                    </div>
                  </div>}
                  {competitors.length > 0 && <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Competitor tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {competitors.map((c) => { const sel = editCompetitorTags.includes(c.name); return <button key={c.name} type="button" onClick={() => setEditCompetitorTags(sel ? editCompetitorTags.filter(x => x !== c.name) : [...editCompetitorTags, c.name])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 " + (sel ? "border-[var(--hm-border)] bg-[var(--tag-red-bg)] text-[var(--tag-red-fg)] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[var(--hm-border)]/50 hover:text-[var(--tag-red-fg)]")}>{c.name}</button>; })}
                    </div>
                  </div>}
                  {editProductTags.length > 0 && (() => { const suggestedPersonas = [...new Set(editProductTags.flatMap(pt => products.find(p => p.name === pt)?.personaNames || []))].filter(n => !editPersonaTags.includes(n)); const suggestedCompetitors = [...new Set(editProductTags.flatMap(pt => products.find(p => p.name === pt)?.competitorNames || []))].filter(n => !editCompetitorTags.includes(n)); return (suggestedPersonas.length > 0 || suggestedCompetitors.length > 0) ? <div className="bg-[var(--tag-blue-bg)] border border-[var(--hm-border)] rounded-lg p-2.5"><p className="text-[10px] font-medium text-[var(--hm-text)] mb-1.5">Suggested from product relationships</p><div className="flex flex-wrap gap-1">{suggestedPersonas.map(n => <button key={n} type="button" onClick={() => setEditPersonaTags([...editPersonaTags, n])} className="px-2 py-0.5 rounded text-[10px] border border-dashed border-[var(--hm-border)] text-[var(--tag-purple-fg)] hover:bg-[var(--tag-purple-bg)]">+ {n}</button>)}{suggestedCompetitors.map(n => <button key={n} type="button" onClick={() => setEditCompetitorTags([...editCompetitorTags, n])} className="px-2 py-0.5 rounded text-[10px] border border-dashed border-[var(--hm-border)] text-[var(--tag-red-fg)] hover:bg-[var(--tag-red-bg)]">+ {n}</button>)}</div></div> : null; })()}

                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Source file URL <span className="font-normal text-[var(--hm-text-tertiary)]">(Canva, Drive, Figma...)</span></label>
                    <input type="url" value={editSourceUrl} onChange={(e) => setEditSourceUrl(e.target.value)} placeholder="https://..." className="text-[13px]" />
                  </div>
                  <div className="pt-3 border-t border-[var(--hm-border)] flex items-center justify-between">
                    <div className="flex gap-2">
                      <button onClick={() => setDeleteConfirm(true)} className="h-8 px-3 text-[var(--tag-red-fg)] text-[12px] hover:bg-[var(--tag-red-bg)] active:bg-[var(--tag-red-bg)] rounded-lg border border-[var(--hm-border)] hover:border-[var(--hm-border)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button>
                      {panelAsset.fileUrl && <a href={`/view/${panelAsset.id}`} target="_blank" rel="noopener" className="h-8 px-3 text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-primary)]/40 rounded-lg border border-[var(--hm-border)] flex items-center transition-colors duration-150">View file</a>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPanelTab("score")} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[var(--hm-primary)]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-1">Cancel</button>
                      <button onClick={saveAssetEdit} disabled={savingEdit || !editName.trim()} className="h-8 px-4 bg-[var(--hm-primary)] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hm-link)] focus-visible:ring-offset-2">{savingEdit ? "Saving..." : "Save"}</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

      {/* Delete confirmation modal */}
      {deleteConfirm && panelAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.4)" }}>
          <div className="bg-[var(--hm-surface)] rounded-2xl p-6 w-[360px] shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-[var(--tag-red-bg)] flex items-center justify-center mx-auto mb-4">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8L13 4" stroke="var(--hm-danger)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-[14px] font-semibold text-center mb-1">Delete asset?</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] text-center mb-5 leading-relaxed">
              <span className="font-medium text-[var(--hm-text)]">&ldquo;{panelAsset.name}&rdquo;</span> will be permanently deleted along with its file and any extracted intelligence. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="flex-1 h-9 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)]">Cancel</button>
              <button onClick={deleteAsset} className="flex-1 h-9 bg-[var(--hm-danger)] text-white rounded-lg text-[12px] font-medium hover:bg-[var(--hm-danger)]">Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
