"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { upload } from "@vercel/blob/client";
import { useUser } from "@/lib/UserContext";

interface Asset {
  id: string; name: string; fileName: string; fileUrl: string | null; fileType: string; fileSize: number | null;
  contentType: string; brandScore: number | null; scoreVoice: number | null; scoreTerminology: number | null;
  scoreMessaging: number | null; scorePersonality: number | null; scoreCompleteness: number | null;
  aiSummary: string | null; scoreSuggestions: string[];
  productTags: string[]; marketTags: string[]; uploadedBy: { name: string }; createdAt: string; scoreStatus: string;
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
  const [products, setProducts] = useState<{ name: string }[]>([]);
  const [markets, setMarkets] = useState<{ name: string }[]>([]);
  const [view, setView] = useState<"tile" | "list">("tile");
  const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadType, setUploadType] = useState("pdf");
  const [uploadContentType, setUploadContentType] = useState("deck");
  const [uploadProduct, setUploadProduct] = useState("");
  const [uploadMarket, setUploadMarket] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterProduct, setFilterProduct] = useState("");
  const [filterMarket, setFilterMarket] = useState("");
  const [filterScore, setFilterScore] = useState("");
  const [filterScoreStatus, setFilterScoreStatus] = useState("");
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<{ total: number; totalPages: number; limit: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Panel state (replaces inline edit panel)
  const [panelAsset, setPanelAsset] = useState<Asset | null>(null);
  const [panelTab, setPanelTab] = useState<"score" | "edit">("score");

  // Edit state (inside panel)
  const [editName, setEditName] = useState("");
  const [editContentType, setEditContentType] = useState("");
  const [editProductTags, setEditProductTags] = useState<string[]>([]);
  const [editMarketTags, setEditMarketTags] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  // Brand review state
  const [brandReview, setBrandReview] = useState<BrandReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [runningReview, setRunningReview] = useState(false);
  const [expandedSection, setExpandedSection] = useState<number | null>(null);

  const fileRef = useRef<File | null>(null);
  const user = useUser();

  const fetchData = useCallback(() => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (filterType) params.set("type", filterType);
    if (filterProduct) params.set("product", filterProduct);
    if (filterMarket) params.set("market", filterMarket);
    if (filterScore) params.set("score", filterScore);
    if (filterScoreStatus) params.set("scoreStatus", filterScoreStatus);
    params.set("page", String(page));
    setLoading(true);
    setFetchError(false);
    fetch("/api/content-library?" + params.toString())
      .then((r) => r.json())
      .then((d) => {
        setAssets(d.assets || []);
        setAvgScore(d.avgScore);
        setProducts(d.products || []);
        setMarkets(d.markets || []);
        setPagination(d.pagination || null);
      })
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false));
  }, [search, filterType, filterProduct, filterMarket, filterScore, filterScoreStatus, page]);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [search, filterType, filterProduct, filterMarket, filterScore, filterScoreStatus]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleFileSelect = (file: File) => { fileRef.current = file; setUploadName(file.name.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ")); setUploadType(file.name.split(".").pop()?.toLowerCase() || "pdf"); };
  const resetUpload = () => { setShowUpload(false); setUploadName(""); setUploadProgress(""); setUploadError(""); fileRef.current = null; };

  const handleUpload = async () => {
    if (!uploadName.trim()) return;
    setUploading(true);
    setUploadError("");
    let fileUrl: string | null = null; let fileSize: number | null = null; let actualFileName: string | null = null;
    if (fileRef.current) {
      setUploadProgress("Uploading file...");
      const file = fileRef.current;
      const SMALL_FILE_LIMIT = 4 * 1024 * 1024; // 4 MB — use server-side PUT below this
      try {
        if (file.size <= SMALL_FILE_LIMIT) {
          // ── Small file: stream through our API route ──────────────────────
          const res = await fetch(
            `/api/upload?filename=${encodeURIComponent(file.name)}`,
            { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file }
          );
          let data: Record<string, unknown> = {};
          try { data = await res.json(); } catch { /* empty body */ }
          if (!res.ok) { setUploadError((data.error as string) || `Upload failed (${res.status})`); setUploading(false); setUploadProgress(""); return; }
          fileUrl = data.fileUrl as string; fileSize = file.size; actualFileName = file.name;
        } else {
          // ── Large file: browser uploads directly to Vercel Blob CDN ──────
          // Bypasses the 4.5 MB serverless body limit entirely.
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 120000); // 2-min safety timeout
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const blob = await upload(`assets/${Date.now()}-${file.name}`, file, { access: "public", handleUploadUrl: "/api/upload", ...(({ abortSignal: controller.signal }) as any) });
            clearTimeout(timeout);
            fileUrl = blob.url; fileSize = file.size; actualFileName = file.name;
          } catch (e) { clearTimeout(timeout); throw e; }
        }
      } catch (e) { console.error(e); setUploadError((e as Error)?.message || "Upload failed. Please try again."); setUploading(false); setUploadProgress(""); return; }
    }
    setUploadProgress("Saving...");
    try {
      const res = await fetch("/api/content-library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ files: [{ name: uploadName, fileName: actualFileName || uploadName.toLowerCase().replace(/\s+/g, "-") + "." + uploadType, fileUrl, fileSize, fileType: uploadType, contentType: uploadContentType, productTags: uploadProduct ? [uploadProduct] : [], marketTags: uploadMarket ? [uploadMarket] : [] }] }) });
      const data = await res.json();
      if (!res.ok) { setUploadError(data.error || "Failed to save asset."); }
      else { resetUpload(); fetchData(); }
    } catch (e) { console.error(e); setUploadError("Failed to save asset. Please try again."); }
    finally { setUploading(false); setUploadProgress(""); }
  };

  const openPanel = async (a: Asset) => {
    setPanelAsset(a);
    setPanelTab("score");
    setEditName(a.name);
    setEditContentType(a.contentType);
    setEditProductTags([...a.productTags]);
    setEditMarketTags([...a.marketTags]);
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
    try { await fetch("/api/content-library/manage", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: panelAsset.id, name: editName, contentType: editContentType, productTags: editProductTags, marketTags: editMarketTags }) }); fetchData(); setPanelTab("score"); } catch { alert("Failed to save"); }
    finally { setSavingEdit(false); }
  };

  const deleteAsset = async () => {
    if (!panelAsset) return;
    setDeleteConfirm(false);
    try { await fetch("/api/content-library/manage?id=" + panelAsset.id, { method: "DELETE" }); closePanel(); fetchData(); } catch { alert("Failed to delete"); }
  };

  const formatSize = (bytes: number | null) => { if (!bytes) return ""; if (bytes < 1024) return bytes + " B"; if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB"; return (bytes / 1048576).toFixed(1) + " MB"; };
  const timeAgo = (date: string) => { const diff = Date.now() - new Date(date).getTime(); const mins = Math.floor(diff / 60000); if (mins < 60) return mins + "m ago"; const hrs = Math.floor(diff / 3600000); if (hrs < 24) return hrs + "h ago"; return Math.floor(diff / 86400000) + "d ago"; };
  const scoreBg = (s: number | null) => s === null ? "bg-gray-400" : s >= 75 ? "bg-emerald-500" : s >= 50 ? "bg-amber-500" : "bg-red-500";
  const scoreText = (s: number | null) => s === null ? "text-gray-400" : s >= 75 ? "text-emerald-500" : s >= 50 ? "text-amber-500" : "text-red-500";
  const scoreBorder = (s: number | null) => s === null ? "#9ca3af" : s >= 75 ? "#10b981" : s >= 50 ? "#f59e0b" : "#ef4444";
  const typeColor = (t: string) => { const c: Record<string, string> = { pdf: "bg-red-100 text-red-600", pptx: "bg-orange-100 text-orange-600", docx: "bg-blue-100 text-blue-600", xlsx: "bg-green-100 text-green-600", mp4: "bg-purple-100 text-purple-600", url: "bg-teal-100 text-teal-600", jpg: "bg-pink-100 text-pink-600", jpeg: "bg-pink-100 text-pink-600", png: "bg-pink-100 text-pink-600" }; return c[t] || "bg-gray-100 text-gray-600"; };
  const isImage = (t: string) => ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(t);
  const hasActiveFilters = search || filterType || filterProduct || filterMarket || filterScore || filterScoreStatus;
  const clearFilters = () => { setSearch(""); setFilterType(""); setFilterProduct(""); setFilterMarket(""); setFilterScore(""); setFilterScoreStatus(""); setPage(1); setSelectedIds(new Set()); };
  const toggleSelect = (id: string, e: React.MouseEvent) => { e.stopPropagation(); e.preventDefault(); setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const allSelected = assets.length > 0 && assets.every(a => selectedIds.has(a.id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(assets.map(a => a.id)));
  const hasFile = fileRef.current !== null;
  const severityColor = (s: string) => s === "high" ? "text-red-500 bg-red-50 border-red-200" : s === "medium" ? "text-amber-600 bg-amber-50 border-amber-200" : "text-gray-500 bg-gray-50 border-gray-200";
  const dimensionOrder = ["voice", "terminology", "messaging", "personality", "completeness"];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        <div className="px-4 md:px-7 py-4 bg-white border-b border-[var(--hm-border)] flex flex-wrap items-center justify-between gap-3" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
          <div className="min-w-0">
            <h1 className="text-[18px] md:text-[22px] font-semibold leading-tight">Asset library</h1>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">{pagination ? pagination.total : assets.length} asset{(pagination ? pagination.total : assets.length) !== 1 ? "s" : ""}{hasActiveFilters ? " (filtered)" : ""}{pagination && pagination.totalPages > 1 ? ` · Page ${page} of ${pagination.totalPages}` : ""}{avgScore !== null ? " · Avg. score: " + avgScore + "%" : ""}</p>
          </div>
          <button onClick={() => setShowUpload(true)} className="h-[34px] w-full sm:w-auto px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90 active:opacity-100 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2 flex-shrink-0" style={{ boxShadow: "0 1px 2px rgba(67,97,238,0.3)" }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 4l3-3 3 3" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /><path d="M2 13h12" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" /></svg>
            Upload files
          </button>
        </div>

        <div className="px-4 md:px-7 py-3 bg-white border-b border-[var(--hm-border)] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-0 overflow-x-auto">
            <div className="relative flex-1 max-w-[240px]">
              <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ position: "absolute", left: "10px", top: "50%", transform: "translateY(-50%)", zIndex: 1 }}><circle cx="6.5" cy="6.5" r="5" stroke="#999" strokeWidth="1.1" /><path d="M14 14l-3-3" stroke="#999" strokeWidth="1.1" strokeLinecap="round" /></svg>
              <input type="text" placeholder="Search files, tags..." value={search} onChange={(e) => setSearch(e.target.value)} className="search-input" />
            </div>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">All types</option><option value="deck">Presentations</option><option value="one_pager">One-pagers</option><option value="case_study">Case studies</option><option value="blog">Blog posts</option><option value="brochure">Brochures</option></select>
            <select value={filterProduct} onChange={(e) => setFilterProduct(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">All products</option>{[...new Set(products.map((p) => p.name))].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={filterMarket} onChange={(e) => setFilterMarket(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">All markets</option>{[...new Set(markets.map((m) => m.name))].map((name) => <option key={name} value={name}>{name}</option>)}</select>
            <select value={filterScore} onChange={(e) => setFilterScore(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">Any score</option><option value="75+">75%+</option><option value="50-74">50-74%</option><option value="below60">Below 60%</option><option value="below50">Below 50%</option></select>
            <select value={filterScoreStatus} onChange={(e) => setFilterScoreStatus(e.target.value)} style={{ height: "38px", fontSize: "12px" }}><option value="">Any status</option><option value="pending">Pending</option><option value="analyzed">Analyzed</option></select>
            {hasActiveFilters && <button onClick={clearFilters} className="text-[11px] text-[#4361ee] hover:underline whitespace-nowrap transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Clear</button>}
          </div>
          <div className="flex items-center gap-0.5 bg-[var(--hm-bg-secondary)] rounded-lg p-0.5 flex-shrink-0">
            <button onClick={() => setView("tile")} className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (view === "tile" ? "bg-white shadow-sm" : "hover:bg-white/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="6" height="6" rx="1" stroke={view === "tile" ? "#4361ee" : "#999"} strokeWidth="1.1" /><rect x="9" y="1" width="6" height="6" rx="1" stroke={view === "tile" ? "#4361ee" : "#999"} strokeWidth="1.1" /><rect x="1" y="9" width="6" height="6" rx="1" stroke={view === "tile" ? "#4361ee" : "#999"} strokeWidth="1.1" /><rect x="9" y="9" width="6" height="6" rx="1" stroke={view === "tile" ? "#4361ee" : "#999"} strokeWidth="1.1" /></svg></button>
            <button onClick={() => setView("list")} className={"w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (view === "list" ? "bg-white shadow-sm" : "hover:bg-white/60")}><svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M2 8h12M2 12h12" stroke={view === "list" ? "#4361ee" : "#999"} strokeWidth="1.2" strokeLinecap="round" /></svg></button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0 overflow-hidden">

          {/* Main scrollable area */}
          <div className="flex-1 overflow-y-auto p-4 md:p-7">

            {/* Upload */}
            {showUpload && (
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-6 mb-5 animate-fade-in">
                <div className="flex items-center justify-between mb-4"><h3 className="text-[15px] font-medium">Upload content</h3><button onClick={resetUpload} className="opacity-40 hover:opacity-100 transition-opacity duration-150 text-lg leading-none w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--hm-bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee]">&times;</button></div>
                {!uploadName ? (
                  <div>
                    <label className="block" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }} onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleFileSelect(f); }}>
                      <div className={"border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all " + (dragOver ? "border-[#4361ee] bg-blue-50/50" : "border-[var(--hm-border)] hover:border-[#4361ee] hover:bg-blue-50/30")}>
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" className="mx-auto mb-3 opacity-30"><path d="M12 5v14M5 12l7-7 7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        <p className="text-[14px] font-medium mb-1">Drag & drop files here</p>
                        <p className="text-[12px] text-[var(--hm-text-tertiary)]">or click to browse</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-2 leading-relaxed">PDF, PPTX, DOCX, XLSX, MP4, images</p>
                      </div>
                      <input type="file" className="hidden" accept=".pdf,.docx,.pptx,.xlsx,.mp4,.jpg,.jpeg,.png,.svg,.gif,.webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }} />
                    </label>
                    <div className="flex items-center gap-3 mt-3"><div className="flex-1 h-px bg-[var(--hm-border)]" /><span className="text-[11px] text-[var(--hm-text-tertiary)]">or</span><div className="flex-1 h-px bg-[var(--hm-border)]" /></div>
                    <button onClick={() => { fileRef.current = null; setUploadName("New Asset"); }} className="w-full mt-3 h-9 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Add manually</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 p-3 bg-[var(--hm-bg-secondary)] rounded-lg">
                      <div className={"w-10 h-10 rounded-lg flex items-center justify-center text-[11px] font-medium " + typeColor(uploadType)}>{uploadType.toUpperCase().slice(0, 4)}</div>
                      <div className="flex-1"><p className="text-[13px] font-medium">{hasFile ? fileRef.current!.name : uploadName}</p><p className="text-[10px] text-[var(--hm-text-tertiary)] mt-0.5">{hasFile ? formatSize(fileRef.current!.size) + " — " : ""}.{uploadType} {hasFile ? <span className="text-emerald-500">&#10003; Attached</span> : <span className="text-amber-500">Metadata only</span>}</p></div>
                      <button onClick={() => { fileRef.current = null; setUploadName(""); }} className="text-[11px] text-[#4361ee] hover:underline">Change</button>
                    </div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Asset name *</label><input type="text" value={uploadName} onChange={(e) => setUploadName(e.target.value)} className="text-[13px]" /></div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">File type</label><select value={uploadType} onChange={(e) => setUploadType(e.target.value)} style={{ fontSize: "12px" }}><option value="pdf">PDF</option><option value="pptx">PPTX</option><option value="docx">DOCX</option><option value="xlsx">XLSX</option><option value="jpg">JPG</option><option value="png">PNG</option><option value="mp4">MP4</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Content type</label><select value={uploadContentType} onChange={(e) => setUploadContentType(e.target.value)} style={{ fontSize: "12px" }}><option value="deck">Deck</option><option value="one_pager">One-pager</option><option value="case_study">Case Study</option><option value="blog">Blog Post</option><option value="brochure">Brochure</option><option value="whitepaper">Whitepaper</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Product</label><select value={uploadProduct} onChange={(e) => setUploadProduct(e.target.value)} style={{ fontSize: "12px" }}><option value="">All</option>{products.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Market</label><select value={uploadMarket} onChange={(e) => setUploadMarket(e.target.value)} style={{ fontSize: "12px" }}><option value="">Global</option>{markets.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}</select></div>
                    </div>
                    {uploadError && <p className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{uploadError}</p>}
                    <div className="flex justify-between items-center pt-2">
                      {uploadProgress && <p className="text-[11px] text-[#4361ee] flex items-center gap-1.5"><span className="w-3 h-3 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin inline-block" />{uploadProgress}</p>}
                      <div className="flex gap-2 ml-auto"><button onClick={resetUpload} className="h-[34px] px-4 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={handleUpload} disabled={uploading || !uploadName.trim()} className="h-[34px] px-5 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{uploading ? "Uploading..." : "Upload"}</button></div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Bulk action bar */}
            {selectedIds.size > 0 && (
              <div className="mb-4 flex items-center gap-3 px-4 py-2.5 bg-[#4361ee]/5 border border-[#4361ee]/20 rounded-xl">
                <span className="text-[12px] font-medium text-[#4361ee]">{selectedIds.size} selected</span>
                <div className="flex-1" />
                <button onClick={toggleSelectAll} className="text-[11px] text-[#4361ee] hover:underline px-2 py-1 rounded-lg hover:bg-blue-50">{allSelected ? "Deselect all" : "Select all"}</button>
                <button onClick={() => setSelectedIds(new Set())} className="text-[11px] text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] px-2 py-1 rounded-lg hover:bg-[var(--hm-bg-secondary)]">Clear</button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Delete ${selectedIds.size} asset${selectedIds.size !== 1 ? "s" : ""}? This cannot be undone.`)) return;
                    await Promise.all([...selectedIds].map(id => fetch("/api/content-library/manage?id=" + id, { method: "DELETE" })));
                    setSelectedIds(new Set());
                    fetchData();
                  }}
                  className="h-7 px-3 bg-red-500 text-white rounded-lg text-[11px] font-medium hover:bg-red-600 flex items-center gap-1.5"
                >
                  <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8L13 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                  Delete {selectedIds.size}
                </button>
              </div>
            )}

            {/* Skeleton loading */}
            {loading && assets.length === 0 && (
              <div className={view === "tile" ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" : "bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden"}>
                {view === "tile" ? Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden animate-pulse">
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
            {!loading && fetchError && (<div className="bg-white border border-[var(--hm-border)] rounded-xl p-14 text-center"><div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4"><svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM8 5v3M8 10h.01" stroke="#ef4444" strokeWidth="1.3" strokeLinecap="round" /></svg></div><p className="text-[15px] font-medium mb-1.5">Failed to load assets</p><p className="text-[13px] text-[var(--hm-text-tertiary)] mb-5 max-w-[300px] mx-auto leading-relaxed">There was a problem fetching your content library. Please try again.</p><button onClick={fetchData} className="h-10 px-6 bg-[#4361ee] text-white rounded-lg text-[13px] font-medium hover:opacity-90">Retry</button></div>)}

            {/* Empty state */}
            {!loading && !fetchError && assets.length === 0 && !showUpload && (
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-14 text-center">
                <div className="w-14 h-14 rounded-full bg-[var(--hm-bg-secondary)] flex items-center justify-center mx-auto mb-4"><svg width="24" height="24" viewBox="0 0 16 16" fill="none"><path d="M12 5v9H4V2h5l3 3z" stroke="#999" strokeWidth="1" /></svg></div>
                <p className="text-[15px] font-medium mb-1.5">{hasActiveFilters ? "No matching assets" : "No content yet"}</p>
                <p className="text-[13px] text-[var(--hm-text-tertiary)] mb-5 max-w-[300px] mx-auto leading-relaxed">{hasActiveFilters ? "Try adjusting your filters." : "Upload assets to get brand compliance scores."}</p>
                {hasActiveFilters ? <button onClick={clearFilters} className="h-10 px-6 border border-[var(--hm-border)] rounded-lg text-[13px]">Clear filters</button> : <button onClick={() => setShowUpload(true)} className="h-10 px-6 bg-[#4361ee] text-white rounded-lg text-[13px] font-medium">Upload your first file</button>}
              </div>
            )}

            {/* Tile view */}
            {!loading && assets.length > 0 && view === "tile" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {assets.map((a) => (
                  <div key={a.id} className={"bg-white border rounded-xl overflow-hidden transition-all group " + (selectedIds.has(a.id) ? "border-[#4361ee] ring-2 ring-[#4361ee]/30" : panelAsset?.id === a.id ? "border-[#4361ee] ring-1 ring-[#4361ee]/20" : "border-[var(--hm-border)] hover:border-[#4361ee]/40")} style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    {/* Thumbnail — click opens viewer */}
                    {a.fileUrl ? (
                      <a href={`/view/${a.id}`} target="_blank" rel="noopener" className="block h-[110px] relative overflow-hidden cursor-pointer">
                        <button onClick={(e) => toggleSelect(a.id, e)} title="Select" className={"absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all " + (selectedIds.has(a.id) ? "bg-[#4361ee] border-[#4361ee]" : "bg-white/80 border-white/50 opacity-0 group-hover:opacity-100")} style={{ backdropFilter: "blur(4px)" }}>
                          {selectedIds.has(a.id) && <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                        </button>
                        {isImage(a.fileType || "") ? (
                          <img src={a.fileUrl} alt={a.name} className="w-full h-full object-cover object-left-top" />
                        ) : (
                          <div className="w-full h-full bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] flex items-center justify-center">
                            <div className={"w-12 h-12 rounded-xl flex items-center justify-center text-[14px] font-medium " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 4)}</div>
                          </div>
                        )}
                        <span className="absolute top-2 text-[10px] px-2 py-0.5 bg-black/50 text-white rounded-md font-medium uppercase backdrop-blur-sm" style={{ left: "30px" }}>{a.fileType || "FILE"}</span>
                        {a.brandScore !== null ? <span className={"absolute top-2 right-2 text-[10px] px-2 py-0.5 text-white rounded-md font-medium " + scoreBg(a.brandScore)}>{Math.round(a.brandScore)}%</span> : <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 bg-black/40 text-white/70 rounded-md font-medium backdrop-blur-sm">Pending</span>}
                        {a.scoreStatus === "analyzed" && <span className="absolute bottom-2 left-2 text-[9px] px-1.5 py-0.5 bg-purple-500/80 text-white rounded-md backdrop-blur-sm">AI Reviewed</span>}
                        <span className="absolute inset-0 transition-all flex items-center justify-center" style={{ background: "rgba(0,0,0,0)" }} onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.45)"} onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0)"}>
                          <span className="opacity-0 group-hover:opacity-100 transition-opacity rounded-lg shadow-md flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5" style={{ background: "#ffffff", color: "#111827" }}>
                            <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M7 2H3a1 1 0 00-1 1v10a1 1 0 001 1h10a1 1 0 001-1V9" stroke="#111827" strokeWidth="1.5" strokeLinecap="round" /><path d="M10 2h4v4M14 2L8 8" stroke="#111827" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                            Open file
                          </span>
                        </span>
                      </a>
                    ) : (
                      <div className="h-[110px] relative overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-br from-[#1a1a2e] to-[#0f3460] flex items-center justify-center">
                          <div className={"w-12 h-12 rounded-xl flex items-center justify-center text-[14px] font-medium " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 4)}</div>
                        </div>
                        <span className="absolute top-2 text-[10px] px-2 py-0.5 bg-black/50 text-white rounded-md font-medium uppercase backdrop-blur-sm" style={{ left: "30px" }}>{a.fileType || "FILE"}</span>
                        {a.brandScore !== null ? <span className={"absolute top-2 right-2 text-[10px] px-2 py-0.5 text-white rounded-md font-medium " + scoreBg(a.brandScore)}>{Math.round(a.brandScore)}%</span> : <span className="absolute top-2 right-2 text-[10px] px-2 py-0.5 bg-black/40 text-white/70 rounded-md font-medium backdrop-blur-sm">Pending</span>}
                        {a.scoreStatus === "analyzed" && <span className="absolute bottom-2 left-2 text-[9px] px-1.5 py-0.5 bg-purple-500/80 text-white rounded-md backdrop-blur-sm">AI Reviewed</span>}
                      </div>
                    )}
                    {/* Card body */}
                    <div className="p-3.5">
                      <p className="text-[13px] font-medium truncate">{a.name}</p>
                      <div className="flex flex-wrap gap-1 mt-2 mb-2">
                        {a.productTags.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-[#4361ee] rounded-md">{t}</span>)}
                        {a.marketTags.map((t) => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{t}</span>)}
                        {a.contentType && <span className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md capitalize">{a.contentType.replace(/_/g, " ")}</span>}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-[var(--hm-text-tertiary)]">{a.uploadedBy.name} &middot; {timeAgo(a.createdAt)}</p>
                        <button
                          onClick={(e) => { e.stopPropagation(); openPanel(a); }}
                          className="text-[10px] text-[#4361ee] hover:underline flex items-center gap-1"
                        >
                          View details
                          <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="#4361ee" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* List view */}
            {!loading && assets.length > 0 && view === "list" && (
              <div className="bg-white border border-[var(--hm-border)] rounded-xl overflow-x-auto">
                <div className="grid grid-cols-[28px_2fr_80px_80px_70px_55px_70px_60px] gap-2 px-4 py-2.5 border-b border-[var(--hm-border)] text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">
                  <button onClick={toggleSelectAll} title={allSelected ? "Deselect all" : "Select all"} className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 " + (allSelected ? "bg-[#4361ee] border-[#4361ee]" : "border-[var(--hm-border)] hover:border-[#4361ee]")}>{allSelected && <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>
                  <span>Name</span><span>Type</span><span>Product</span><span>Market</span><span>Score</span><span>Status</span><span></span>
                </div>
                {assets.map((a) => (
                  <div key={a.id} className={"grid grid-cols-[28px_2fr_80px_80px_70px_55px_70px_60px] gap-2 px-4 py-2.5 border-b border-[var(--hm-border)] items-center last:border-b-0 group " + (selectedIds.has(a.id) ? "bg-blue-50/40" : panelAsset?.id === a.id ? "bg-blue-50/30" : "hover:bg-[var(--hm-bg-secondary)]")}>
                    <button onClick={(e) => toggleSelect(a.id, e)} title="Select" className={"w-4 h-4 rounded border-2 flex items-center justify-center transition-all flex-shrink-0 opacity-0 group-hover:opacity-100 " + (selectedIds.has(a.id) ? "!opacity-100 bg-[#4361ee] border-[#4361ee]" : "border-[var(--hm-border)] hover:border-[#4361ee]")}>{selectedIds.has(a.id) && <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 8l4 4 6-6" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg>}</button>
                    {a.fileUrl ? (
                      <a href={`/view/${a.id}`} target="_blank" rel="noopener" className="flex items-center gap-2.5 min-w-0 cursor-pointer">
                        <div className={"w-7 h-7 rounded-md flex items-center justify-center text-[9px] font-medium flex-shrink-0 " + typeColor(a.fileType || "")}>{(a.fileType || "?").toUpperCase().slice(0, 3)}</div>
                        <span className="text-[12px] font-medium truncate hover:text-[#4361ee] hover:underline">{a.name}</span>
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
                    <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-medium w-fit " + (a.scoreStatus === "analyzed" ? "bg-purple-50 text-purple-600" : a.brandScore !== null ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400")}>{a.scoreStatus === "analyzed" ? "Reviewed" : a.brandScore !== null ? "Scored" : "Pending"}</span>
                    <button
                      onClick={() => openPanel(a)}
                      className="text-[10px] text-[#4361ee] hover:underline whitespace-nowrap"
                    >
                      Details →
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination controls */}
            {pagination && pagination.totalPages > 1 && (
              <div className="mt-6 flex items-center justify-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] disabled:opacity-40 hover:border-[#4361ee] hover:text-[#4361ee] transition-colors"
                >
                  &larr; Prev
                </button>
                <span className="text-[12px] text-[var(--hm-text-tertiary)] px-2">
                  {page} / {pagination.totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={page >= pagination.totalPages}
                  className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] disabled:opacity-40 hover:border-[#4361ee] hover:text-[#4361ee] transition-colors"
                >
                  Next &rarr;
                </button>
              </div>
            )}
          </div>

          {/* Right-side detail panel */}
          {panelAsset && (
            <div className="w-full sm:w-[360px] md:w-[400px] flex-shrink-0 bg-white border-t sm:border-t-0 sm:border-l border-[var(--hm-border)] flex flex-col h-full overflow-hidden">

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
                        {panelAsset.productTags.map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-[#4361ee] rounded-md">{t}</span>)}
                        {panelAsset.marketTags.map(t => <span key={t} className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{t}</span>)}
                      </div>
                    )}
                  </div>
                </div>
                <button onClick={closePanel} className="text-[var(--hm-text-tertiary)] hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)] flex-shrink-0 ml-2 w-7 h-7 flex items-center justify-center rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee]">&times;</button>
              </div>

              {/* Tab bar */}
              <div className="flex border-b border-[var(--hm-border)] flex-shrink-0">
                <button onClick={() => setPanelTab("score")} className={"flex-1 py-2.5 text-[12px] border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (panelTab === "score" ? "font-medium text-[#4361ee] border-[#4361ee]" : "text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)]")}>Brand score</button>
                <button onClick={() => setPanelTab("edit")} className={"flex-1 py-2.5 text-[12px] border-b-2 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (panelTab === "edit" ? "font-medium text-[#4361ee] border-[#4361ee]" : "text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)]")}>Edit details</button>
              </div>

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
                          <span className={"text-[9px] px-1.5 py-0.5 rounded-md font-medium " + (panelAsset.scoreStatus === "analyzed" ? "bg-purple-50 text-purple-600" : panelAsset.brandScore !== null ? "bg-emerald-50 text-emerald-600" : "bg-gray-100 text-gray-400")}>{panelAsset.scoreStatus === "analyzed" ? "AI Reviewed" : panelAsset.brandScore !== null ? "Auto-scored" : "Pending analysis"}</span>
                        </div>
                        {panelAsset.aiSummary ? (
                          <p className="text-[11px] text-[var(--hm-text-secondary)] leading-relaxed">{panelAsset.aiSummary}</p>
                        ) : (
                          <p className="text-[11px] text-[var(--hm-text-tertiary)]">Run a brand review to get AI-powered section analysis and improvement suggestions.</p>
                        )}
                      </div>
                    </div>
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
                            <span className="w-4 h-4 rounded-full bg-[#4361ee] text-white text-[9px] font-medium flex items-center justify-center flex-shrink-0 mt-0.5">{i + 1}</span>
                            <p className="text-[11px] text-[var(--hm-text-secondary)] leading-relaxed">{fix}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Flagged sections (from full review) */}
                  {reviewLoading && (
                    <div className="px-5 py-8 flex items-center justify-center gap-2">
                      <div className="w-4 h-4 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
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
                          <div key={i} className={"border rounded-xl overflow-hidden " + (section.severity === "high" ? "border-red-200 border-l-[3px] border-l-red-500" : section.severity === "medium" ? "border-amber-200 border-l-[3px] border-l-amber-500" : "border-[var(--hm-border)] border-l-[3px] border-l-gray-300")}>
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
                                    <p className="text-[11px] italic text-[var(--hm-text-secondary)] bg-white border border-[var(--hm-border)] rounded-lg px-2.5 py-2 leading-relaxed">"{section.excerpt}"</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-1">Issue</p>
                                    <p className="text-[11px] text-[var(--hm-text)] leading-relaxed">{section.issue}</p>
                                  </div>
                                  <div>
                                    <p className="text-[9px] text-[var(--hm-text-tertiary)] uppercase tracking-wide mb-1">Suggested improvement</p>
                                    <p className="text-[11px] text-[var(--hm-text)] leading-relaxed rounded-lg px-2.5 py-2" style={{ background: "color-mix(in srgb, #10B981 12%, var(--hm-surface))", border: "1px solid color-mix(in srgb, #10B981 30%, var(--hm-border))" }}>{section.suggestion}</p>
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
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#4361ee]/10 to-[#7c3aed]/10 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
                      </div>
                      <div>
                        <p className="text-[12px] font-medium text-[var(--hm-text)]">Analyzing brand compliance…</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">This can take 10–30 seconds</p>
                      </div>
                      <div className="w-full max-w-[180px] h-1 bg-[var(--hm-border)] rounded-full overflow-hidden mt-1">
                        <div className="h-full bg-gradient-to-r from-[#4361ee] to-[#7c3aed] rounded-full animate-pulse" style={{ width: "60%" }} />
                      </div>
                    </div>
                  )}

                  {/* CTA to run review */}
                  {!reviewLoading && !brandReview && !runningReview && (
                    <div className="px-5 py-6">
                      <div className="bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-100 rounded-xl p-4 text-center">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center mx-auto mb-3">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 2l1.5 3.5L13 6.5l-2.5 2.5.5 3.5L8 11l-3 1.5.5-3.5L3 6.5l3.5-1L8 2z" stroke="white" strokeWidth="1.1" fill="none" strokeLinejoin="round" /></svg>
                        </div>
                        <p className="text-[12px] font-medium mb-1">AI brand review</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-4 leading-relaxed">Get section-by-section brand analysis with specific improvement suggestions for each flagged passage.</p>
                        <button
                          onClick={runBrandReview}
                          className="h-[34px] px-5 bg-gradient-to-r from-[#4361ee] to-[#7c3aed] text-white rounded-lg text-[12px] font-medium hover:opacity-90 flex items-center gap-2 mx-auto"
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
                        className="w-full h-[34px] border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors flex items-center justify-center gap-2"
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
                      <option value="blog">Blog Post</option><option value="brochure">Brochure</option><option value="whitepaper">Whitepaper</option><option value="video">Video</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Product tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {products.map((p) => { const sel = editProductTags.includes(p.name); return <button key={p.name} type="button" onClick={() => setEditProductTags(sel ? editProductTags.filter(x => x !== p.name) : [...editProductTags, p.name])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (sel ? "border-[#4361ee] bg-blue-50 text-[#4361ee] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[#4361ee]/50 hover:text-[#4361ee]")}>{p.name}</button>; })}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Market tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {markets.map((m) => { const sel = editMarketTags.includes(m.name); return <button key={m.name} type="button" onClick={() => setEditMarketTags(sel ? editMarketTags.filter(x => x !== m.name) : [...editMarketTags, m.name])} className={"px-2.5 py-1 rounded-lg text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (sel ? "border-[#4361ee] bg-blue-50 text-[#4361ee] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[#4361ee]/50 hover:text-[#4361ee]")}>{m.name}</button>; })}
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[var(--hm-border)] flex items-center justify-between">
                    <div className="flex gap-2">
                      <button onClick={() => setDeleteConfirm(true)} className="h-8 px-3 text-red-500 text-[12px] hover:bg-red-50 active:bg-red-100 rounded-lg border border-red-200 hover:border-red-300 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button>
                      {panelAsset.fileUrl && <a href={`/view/${panelAsset.id}`} target="_blank" rel="noopener" className="h-8 px-3 text-[12px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 rounded-lg border border-[var(--hm-border)] flex items-center transition-colors duration-150">View file</a>}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => setPanelTab("score")} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
                      <button onClick={saveAssetEdit} disabled={savingEdit || !editName.trim()} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{savingEdit ? "Saving..." : "Save"}</button>
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
          <div className="bg-white rounded-2xl p-6 w-[360px] shadow-2xl">
            <div className="w-10 h-10 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
              <svg width="18" height="18" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8L13 4" stroke="#ef4444" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </div>
            <p className="text-[14px] font-semibold text-center mb-1">Delete asset?</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] text-center mb-5 leading-relaxed">
              <span className="font-medium text-[var(--hm-text)]">&ldquo;{panelAsset.name}&rdquo;</span> will be permanently deleted along with its file and any extracted intelligence. This cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setDeleteConfirm(false)} className="flex-1 h-9 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)]">Cancel</button>
              <button onClick={deleteAsset} className="flex-1 h-9 bg-red-500 text-white rounded-lg text-[12px] font-medium hover:bg-red-600">Delete permanently</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
