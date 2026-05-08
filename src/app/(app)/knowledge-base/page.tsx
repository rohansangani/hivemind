"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { useUser } from "@/lib/UserContext";

interface Skill { id: string; name: string; category: string; linkedFeature: string; description: string; instructions: string; isActive: boolean; }
interface Product { id: string; name: string; description: string; classification: string; scope: string; features: string[]; category: string; marketNames: string[]; }
interface Market { id: string; name: string; type: string; }
interface Persona { id: string; title: string; department: string; seniority: string; painPoints: string; howWeHelp: string; contentPrefs: string[]; }
interface Competitor { id: string; name: string; website: string; positioning: string; differentiator: string; marketOverlap: string[]; }
interface Brand { traits: string[]; archetype: string; toneFormal: number; toneTechnical: number; toneSerious: number; toneCorporate: number; voiceDescription: string; wordsWeUse: string[]; wordsWeAvoid: string[]; competitiveMoat: string; }
interface Org { name: string; description: string; industry: string; subIndustry: string; size: string; hqCity: string; hqCountry: string; yearFounded: number | null; mission: string; vision: string; }

const DEFAULTS = [
  { category: "writing", name: "Blog writing", desc: "SEO structure, CTA placement", feature: "content_generator", instructions: "Write blog posts with SEO structure. Use H2/H3. Include intro, 3-4 sections, conclusion with CTA." },
  { category: "writing", name: "LinkedIn posts", desc: "Hook-first, numbered insights", feature: "content_generator", instructions: "Start with strong hook. Short paragraphs. Numbered insights. End with question/CTA. 3-5 hashtags." },
  { category: "writing", name: "Thought leadership", desc: "Narrative, first-person", feature: "content_generator", instructions: "First-person narrative with data-backed claims. Include byline. 1500-2500 words." },
  { category: "writing", name: "Email copywriting", desc: "Subject lines, CTA patterns", feature: "content_generator", instructions: "Subject lines under 50 chars. Lead with value. Scannable. One clear CTA." },
  { category: "brand_design", name: "Logo usage", desc: "Clear space, size, variants", feature: "brand_scoring", instructions: "Min clear space 1x height. Min 24px digital. Blue on light, white on dark." },
  { category: "brand_design", name: "Color palette", desc: "Primary, secondary, accent", feature: "brand_scoring", instructions: "Blue #4361EE for CTAs. Navy for headers. 60/30/10 ratio. WCAG AA." },
  { category: "ai_behavior", name: "Response formatting", desc: "Structure, citations", feature: "ai_assistant", instructions: "Clear sections. Bold key terms. Cite sources. Under 300 words simple, 800 complex." },
  { category: "ai_behavior", name: "Competitive positioning", desc: "How to frame vs. others", feature: "ai_assistant", instructions: "Lead with strengths. Factual comparisons. Frame as 'we offer X, they focus on Y'." },
];

function MarketPicker({ markets, selected, onChange }: { markets: Market[]; selected: string[]; onChange: (v: string[]) => void }) {
  if (markets.length === 0) return <span className="text-[11px] text-[var(--hm-text-tertiary)]">No markets defined yet</span>;
  return (<div className="flex flex-wrap gap-1.5">{markets.map(m => { const sel = selected.includes(m.name); return <button key={m.id} type="button" onClick={() => onChange(sel ? selected.filter(x => x !== m.name) : [...selected, m.name])} className={"px-2.5 py-1 rounded-md text-[11px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] " + (sel ? "border-[#4361ee] bg-blue-50 text-[#4361ee] font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-tertiary)] hover:border-[#4361ee] hover:text-[#4361ee]")}>{m.name}</button>; })}</div>);
}

function AiBtn({ loading, onClick, label }: { loading: boolean; onClick: () => void; label?: string }) {
  return <button type="button" onClick={onClick} disabled={loading} aria-label={loading ? "AI thinking" : (label || "AI suggest")} className="h-7 px-2.5 bg-gradient-to-r from-[#4361ee] to-[#7c3aed] text-white rounded-md text-[10px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#7c3aed] focus-visible:ring-offset-2">{loading ? <span aria-hidden="true" className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" /> : <span aria-hidden="true">&#10024;</span>}{loading ? "Thinking..." : (label || "AI suggest")}</button>;
}

export default function KnowledgeBasePage() {
  const user = useUser();
  const [tab, setTab] = useState<"overview" | "skills" | "learning" | "documents" | "brand_style">("overview");
  const [org, setOrg] = useState<Org | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [brand, setBrand] = useState<Brand | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthResult, setSynthResult] = useState<{ synthesized: number; categories: { name: string; count: number }[] } | null>(null);
  const [logs, setLogs] = useState<Array<{ id: string; sourceType: string; title: string; summary: string; takeaway: string; tags: string[]; kbCategories?: string[]; createdAt: string; sourceDocumentName?: string | null; sourceDocumentFile?: string | null }>>([]);
  const [docs, setDocs] = useState<Array<{ id: string; name: string; fileName: string; fileType: string; fileSize: number | null; status: string; learningsCount: number; createdAt: string }>>([]);
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError] = useState("");
  const [docProgress, setDocProgress] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<{ section: string; id: string; label: string } | null>(null);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showAddPersona, setShowAddPersona] = useState(false);
  const [showAddCompetitor, setShowAddCompetitor] = useState(false);
  const [newProd, setNewProd] = useState({ name: "", description: "", category: "core", classification: "", scope: "global", features: [] as string[], marketNames: [] as string[] });
  const [newPersona, setNewPersona] = useState({ title: "", department: "", seniority: "", painPoints: "", howWeHelp: "" });
  const [newComp, setNewComp] = useState({ name: "", website: "", positioning: "", differentiator: "", marketOverlap: [] as string[] });
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editProd, setEditProd] = useState<Product | null>(null);
  const [editPersona, setEditPersona] = useState<Persona | null>(null);
  const [editComp, setEditComp] = useState<Competitor | null>(null);
  const [editBrand, setEditBrand] = useState<Brand | null>(null);
  const [newMarket, setNewMarket] = useState({ name: "", notes: "" });
  const [editMarket, setEditMarket] = useState<{ id: string; name: string; notes: string } | null>(null);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [activeSkillGroup, setActiveSkillGroup] = useState("synthesized");
  const [showAddSkill, setShowAddSkill] = useState(false);
  const [newSkill, setNewSkill] = useState({ name: "", category: "writing", linkedFeature: "content_generator", description: "", instructions: "" });
  const [seeded, setSeeded] = useState(false);
  const [importingSkills, setImportingSkills] = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number } | null>(null);
  const [importError, setImportError] = useState("");
  const skillImportRef = useRef<HTMLInputElement>(null);
  const [aiLoading, setAiLoading] = useState<string | null>(null);
  const [aiError, setAiError] = useState("");

  // Brand style guide
  interface StyleColor { name: string; hex: string; usage: string; }
  interface StyleFont { family: string; weight: string; notes: string; }
  interface StyleLogo { name: string; url: string; usage: string; }
  interface StyleGuide {
    colors: StyleColor[];
    typography: { heading: StyleFont; body: StyleFont; accent: StyleFont };
    logoVariants: StyleLogo[];
    guidelines: string;
    doNotUse: string;
  }
  const EMPTY_STYLE: StyleGuide = {
    colors: [],
    typography: { heading: { family: "", weight: "700", notes: "" }, body: { family: "", weight: "400", notes: "" }, accent: { family: "", weight: "400", notes: "" } },
    logoVariants: [],
    guidelines: "",
    doNotUse: "",
  };
  const [styleGuide, setStyleGuide] = useState<StyleGuide>(EMPTY_STYLE);
  const [styleLoaded, setStyleLoaded] = useState(false);
  const [styleSaving, setStyleSaving] = useState(false);
  const [styleSaved, setStyleSaved] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  // Full auto-populate
  const [showFullAI, setShowFullAI] = useState(false);
  const [fullAiSuggestions, setFullAiSuggestions] = useState<Record<string, unknown> | null>(null);
  const [fullAiSections, setFullAiSections] = useState<string[]>(["company", "products", "markets", "personas", "competitors", "brand"]);

  const fetchAll = () => {
    fetch("/api/knowledge").then(r => r.json()).then(d => { setOrg(d.org); setProducts(d.products || []); setMarkets(d.markets || []); setPersonas(d.personas || []); setCompetitors(d.competitors || []); setBrand(d.brandProfile); setLogs(d.learningLogs || []); });
    fetch("/api/skills").then(r => r.json()).then(d => setSkills(d.skills || []));
    fetch("/api/knowledge/documents").then(r => r.json()).then(d => setDocs(d.documents || []));
  };

  const fetchStyleGuide = () => {
    fetch("/api/knowledge/brand-style").then(r => r.json()).then(d => {
      if (d.styleGuide) {
        setStyleGuide({ ...EMPTY_STYLE, ...d.styleGuide, typography: { ...EMPTY_STYLE.typography, ...d.styleGuide.typography } });
      }
      setStyleLoaded(true);
    }).catch(() => setStyleLoaded(true));
  };

  const saveStyleGuide = async (guide: StyleGuide) => {
    setStyleSaving(true);
    await fetch("/api/knowledge/brand-style", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(guide) });
    setStyleSaving(false);
    setStyleSaved(true);
    setTimeout(() => setStyleSaved(false), 2000);
  };

  const uploadLogo = async (file: File): Promise<string | null> => {
    try {
      const { upload } = await import("@vercel/blob/client");
      const blob = await upload(`brand-logos/${Date.now()}-${file.name}`, file, {
        access: "public",
        handleUploadUrl: "/api/knowledge/brand-style/logo-upload-url",
      });
      return blob.url;
    } catch { return null; }
  };

  const uploadDocuments = async (files: FileList | File[]) => {
    const fileArr = Array.from(files);
    if (!fileArr.length) return;
    setDocUploading(true); setDocError(""); setDocProgress({ done: 0, total: fileArr.length });
    try {
      // Upload directly from the browser to Vercel Blob — bypasses the 4.5 MB serverless body limit
      const blobFiles = await Promise.all(
        fileArr.map(file =>
          upload(`kb-docs/${Date.now()}-${file.name}`, file, {
            access: "public",
            handleUploadUrl: "/api/knowledge/documents/upload-url",
          }).then(blob => ({ url: blob.url, name: file.name, size: file.size }))
        )
      );

      // Send blob URLs to the server for analysis + DB storage
      const res = await fetch("/api/knowledge/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: blobFiles }),
      });
      const text = await res.text();
      let data: Record<string, unknown>;
      try { data = JSON.parse(text); }
      catch {
        setDocError(`Upload failed (${res.status}) — please try again.`);
        return;
      }
      if (data.error) { setDocError(data.error as string); }
      else { setDocProgress({ done: fileArr.length, total: fileArr.length }); fetchAll(); setTab("documents"); }
    } catch (e) { setDocError(e instanceof Error ? e.message : "Upload failed. Please try again."); }
    finally { setDocUploading(false); setDocProgress(null); }
  };

  const deleteDocument = async (id: string) => {
    await fetch("/api/knowledge/documents?id=" + id, { method: "DELETE" });
    fetchAll();
  };
  useEffect(() => {
    // Run deduplication silently on mount, then fetch fresh data
    fetch("/api/knowledge/deduplicate", { method: "POST" }).finally(() => fetchAll());
    fetchStyleGuide();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveEdit = async (section: string, data: Record<string, unknown>) => { setSaving(true); await fetch("/api/knowledge/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, ...data }) }); setSaving(false); setSaved("Saved!"); fetchAll(); setEditingItemId(null); setEditProd(null); setEditPersona(null); setEditComp(null); setTimeout(() => setSaved(""), 2000); };
  const deleteItem = async (section: string, id: string) => { await fetch("/api/knowledge/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section, id }) }); fetchAll(); setEditingItemId(null); };
  const confirmAndDelete = (section: string, id: string, label: string) => setConfirmDelete({ section, id, label });

  const aiSuggest = async (type: string, context: Record<string, unknown>, onResult: (data: Record<string, unknown>) => void) => {
    setAiLoading(type); setAiError("");
    try {
      const res = await fetch("/api/knowledge/ai-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, context }) });
      const data = await res.json();
      if (data.suggestion) { onResult(data.suggestion); }
      else { setAiError(data.error || "AI suggestion failed"); }
    } catch { setAiError("Something went wrong"); }
    finally { setAiLoading(null); }
  };

  const seedDefaults = async () => { setSeeded(true); for (const s of DEFAULTS) { await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name, category: s.category, linkedFeature: s.feature, description: s.desc, instructions: s.instructions }) }); } fetchAll(); };

  const parseSkillsMd = (text: string): Array<{ name: string; category: string; linkedFeature: string; description: string; instructions: string }> => {
    const catMap: Record<string, string> = { "writing": "writing", "brand": "brand_design", "brand & design": "brand_design", "ai behavior": "ai_behavior", "seo": "seo" };
    const featureMap: Record<string, string> = { "content generator": "content_generator", "brand scoring": "brand_scoring", "ai assistant": "ai_assistant", "all features": "all", "all": "all" };
    const parsed: Array<{ name: string; category: string; linkedFeature: string; description: string; instructions: string }> = [];
    const lines = text.split("\n");
    let currentCategory = "writing";
    let currentFeature = "content_generator";
    let i = 0;
    while (i < lines.length) {
      const line = lines[i].trim();
      // ## section headers set category context
      if (line.startsWith("## ")) {
        const h = line.slice(3).toLowerCase();
        if (h.includes("learned") || h.includes("synthesized")) { currentCategory = "__skip__"; i++; continue; }
        for (const [k, v] of Object.entries(catMap)) { if (h.includes(k)) { currentCategory = v; break; } }
        i++; continue;
      }
      // # top-level heading — single-skill format: treat as skill name
      if (line.startsWith("# ") && !line.includes("—") && !line.includes("Skills")) {
        const name = line.slice(2).trim();
        let description = ""; let feature = currentFeature; const instrLines: string[] = []; i++;
        while (i < lines.length && lines[i].trim() === "") i++;
        if (i < lines.length && lines[i].trim().startsWith("> ")) { description = lines[i].trim().slice(2).trim(); i++; }
        while (i < lines.length && lines[i].trim() === "") i++;
        while (i < lines.length) {
          const l = lines[i].trim();
          if (l.startsWith("**Category:**")) { const v = l.slice("**Category:**".length).trim().toLowerCase(); for (const [k, cv] of Object.entries(catMap)) { if (v.includes(k)) { currentCategory = cv; break; } } i++; continue; }
          if (l.startsWith("**Feature:**")) { const v = l.slice("**Feature:**".length).trim().toLowerCase(); for (const [k, fv] of Object.entries(featureMap)) { if (v.includes(k)) { feature = fv; break; } } i++; continue; }
          if (l === "---" || l.startsWith("# ") || l.startsWith("## ") || l.startsWith("### ")) break;
          instrLines.push(lines[i]); i++;
        }
        const instructions = instrLines.join("\n").trim();
        if (name && instructions && currentCategory !== "__skip__") parsed.push({ name, category: currentCategory, linkedFeature: feature, description, instructions });
        continue;
      }
      // ### skill headings
      if (line.startsWith("### ")) {
        const name = line.slice(4).trim();
        if (!name || currentCategory === "__skip__") { i++; continue; }
        let description = ""; let feature = currentFeature; const instrLines: string[] = []; i++;
        while (i < lines.length && lines[i].trim() === "") i++;
        if (i < lines.length && lines[i].trim().startsWith("> ")) { description = lines[i].trim().slice(2).trim(); i++; }
        while (i < lines.length && lines[i].trim() === "") i++;
        if (i < lines.length && lines[i].trim().startsWith("**Feature:**")) { const v = lines[i].trim().slice("**Feature:**".length).trim().toLowerCase(); for (const [k, fv] of Object.entries(featureMap)) { if (v.includes(k)) { feature = fv; break; } } i++; }
        while (i < lines.length && lines[i].trim() === "") i++;
        while (i < lines.length) {
          const l = lines[i].trim();
          if (l === "---" || l.startsWith("## ") || l.startsWith("### ")) break;
          instrLines.push(lines[i]); i++;
        }
        const instructions = instrLines.join("\n").trim();
        if (name && instructions) parsed.push({ name, category: currentCategory, linkedFeature: feature, description, instructions });
        continue;
      }
      i++;
    }
    return parsed;
  };

  const importSkillsMd = async (file: File) => {
    setImportingSkills(true); setImportError(""); setImportResult(null);
    try {
      const text = await file.text();
      const parsed = parseSkillsMd(text);
      if (!parsed.length) { setImportError("No skills found in file. Make sure it follows the HiveMind skill format."); return; }
      const existingNames = new Set(skills.map(s => s.name.toLowerCase()));
      let imported = 0; let skipped = 0;
      for (const s of parsed) {
        if (existingNames.has(s.name.toLowerCase())) { skipped++; continue; }
        const res = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) });
        if (res.ok) { imported++; existingNames.add(s.name.toLowerCase()); } else skipped++;
      }
      setImportResult({ imported, skipped });
      fetchAll();
      setTimeout(() => setImportResult(null), 4000);
    } catch (e) { setImportError(e instanceof Error ? e.message : "Import failed"); }
    finally { setImportingSkills(false); if (skillImportRef.current) skillImportRef.current.value = ""; }
  };
  const addSkill = async () => { if (!newSkill.name || !newSkill.instructions) return; setSaving(true); await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newSkill) }); setShowAddSkill(false); setNewSkill({ name: "", category: "writing", linkedFeature: "content_generator", description: "", instructions: "" }); fetchAll(); setSaving(false); setSaved("Skill added!"); setTimeout(() => setSaved(""), 2000); };
  const updateSkill = async () => { if (!editingSkill) return; setSaving(true); await fetch("/api/skills", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingSkill.id, name: editingSkill.name, description: editingSkill.description, instructions: editingSkill.instructions, isActive: editingSkill.isActive }) }); setEditingSkill(null); fetchAll(); setSaving(false); setSaved("Skill updated!"); setTimeout(() => setSaved(""), 2000); };
  const delSkill = async (id: string) => { await fetch("/api/skills?id=" + id, { method: "DELETE" }); fetchAll(); if (editingSkill?.id === id) setEditingSkill(null); };
  const confirmAndDelSkill = (id: string, name: string) => setConfirmDelete({ section: "__skill__", id, label: name });
  const toggleSkill = async (s: Skill) => { await fetch("/api/skills", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, isActive: !s.isActive }) }); fetchAll(); };

  const synthesizeSkills = async () => {
    setSynthesizing(true); setSynthResult(null);
    try {
      const res = await fetch("/api/knowledge/synthesize-skills", { method: "POST" });
      const data = await res.json();
      if (data.synthesized !== undefined) { setSynthResult(data); fetchAll(); }
    } finally { setSynthesizing(false); }
  };

  const kbCats = org ? [!!org.description, products.length > 0, markets.length > 0, personas.length > 0, competitors.length > 0, !!brand] : [];
  const kbHealth = kbCats.length > 0 ? Math.round((kbCats.filter(Boolean).length / kbCats.length) * 100) : 0;
  const fl = (f: string) => ({ content_generator: "Content Generator", brand_scoring: "Brand Scoring", ai_assistant: "AI Assistant" }[f] || f);
  const closeAll = () => { setEditingItemId(null); setEditProd(null); setEditPersona(null); setEditComp(null); setEditBrand(null); setShowAddProduct(false); setShowAddPersona(false); setShowAddCompetitor(false); };

  if (!org) return <div role="status" aria-label="Loading knowledge base" className="min-h-screen flex items-center justify-center"><div aria-hidden="true" className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" /></div>;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-7 py-4 bg-white border-b border-[var(--hm-border)] flex items-center justify-between" style={{ boxShadow: "var(--hm-shadow-xs)" }}>
          <div><h1 className="text-[22px] font-semibold leading-tight">Knowledge base</h1><p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Company intelligence · skills · learning</p></div>
          {saved && <div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 border border-green-200 text-green-700 rounded-lg text-[12px] font-medium animate-fade-in-fast"><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.5l3 3 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>{saved}</div>}
        </div>
        <div className="px-7 bg-white border-b border-[var(--hm-border)] flex gap-0">
          {([
            { id: "overview" as const, l: "Overview" },
            { id: "brand_style" as const, l: "Brand style", b: (styleGuide.colors.length > 0 || styleGuide.logoVariants.length > 0) ? "✓" : null },
            { id: "documents" as const, l: "Documents", b: docs.length > 0 ? String(docs.length) : null },
            { id: "skills" as const, l: "Skills", b: skills.length > 0 ? String(skills.length) : null },
            { id: "learning" as const, l: "Learning log", b: logs.length > 0 ? String(logs.length) : null },
          ] as Array<{ id: typeof tab; l: string; b?: string | null }>).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={"px-4 py-2.5 text-[12px] border-b-2 flex items-center gap-1.5 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#4361ee] " + (tab === t.id ? "font-medium text-[#4361ee] border-[#4361ee]" : "text-[var(--hm-text-tertiary)] border-transparent hover:text-[var(--hm-text)] hover:bg-[var(--hm-bg-secondary)]")}>{t.l}{t.b && <span className={"text-[9px] px-1.5 py-0.5 rounded-md " + (t.b === "✓" ? "bg-emerald-500 text-white" : "bg-[#4361ee] text-white")}>{t.b}</span>}</button>
          ))}
        </div>
        <div className={tab === "skills" ? "flex-1 overflow-hidden flex flex-col" : "flex-1 overflow-y-auto p-7"}>

          {tab === "overview" && (
            <div className="animate-fade-in max-w-[720px]">
              <div className="grid grid-cols-4 gap-3 mb-5">
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: kbHealth >= 75 ? "#10B981" : "#F59E0B" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">KB Health</p>
                    <p className={"text-[28px] font-bold mt-1 leading-none " + (kbHealth >= 75 ? "text-emerald-500" : "text-amber-500")}>{kbHealth}%</p>
                    <div className="w-full h-1 rounded-full bg-[var(--hm-border)] mt-2 overflow-hidden">
                      <div className={"h-full rounded-full " + (kbHealth >= 75 ? "bg-emerald-500" : "bg-amber-500")} style={{ width: kbHealth + "%" }} />
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#4361EE" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Products</p>
                    <p className="text-[28px] font-bold mt-1 leading-none">{products.length}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">In knowledge base</p>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#8B5CF6" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Personas</p>
                    <p className="text-[28px] font-bold mt-1 leading-none">{personas.length}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Buyer profiles</p>
                  </div>
                </div>
                <div className="p-4 bg-white border border-[var(--hm-border)] rounded-xl overflow-hidden relative" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-xl" style={{ background: "#EF4444" }} />
                  <div className="pl-1">
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium">Competitors</p>
                    <p className="text-[28px] font-bold mt-1 leading-none">{competitors.length}</p>
                    <p className="text-[10px] text-[var(--hm-text-tertiary)] mt-1.5">Being tracked</p>
                  </div>
                </div>
              </div>

              {/* Full AI Auto-populate banner */}
              <div className="bg-gradient-to-r from-[#4361ee]/5 to-[#7c3aed]/5 border border-[#4361ee]/20 rounded-xl p-4 mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2" /></svg></div>
                  <div><p className="text-[13px] font-semibold">AI Auto-populate</p><p className="text-[11px] text-[var(--hm-text-tertiary)] leading-relaxed">Analyze your website and fill entire knowledge base</p></div>
                </div>
                <AiBtn loading={aiLoading === "full"} onClick={() => aiSuggest("full", {}, (data) => { setFullAiSuggestions(data); setShowFullAI(true); })} label="Auto-populate all" />
              </div>

              {showFullAI && fullAiSuggestions && (
                <div className="bg-white border-2 border-[#4361ee] rounded-xl p-5 mb-5 animate-fade-in">
                  <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-medium">Review AI Suggestions</h3><button onClick={() => { setShowFullAI(false); setFullAiSuggestions(null); }} className="opacity-40 hover:opacity-100 transition-opacity duration-150 w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--hm-bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee]">&times;</button></div>
                  <div className="space-y-2 mb-4">
                    {[{ key: "company", label: "Company Profile" }, { key: "products", label: "Products (" + ((fullAiSuggestions.products as unknown[])?.length || 0) + ")" }, { key: "markets", label: "Markets (" + ((fullAiSuggestions.markets as unknown[])?.length || 0) + ")" }, { key: "personas", label: "Personas (" + ((fullAiSuggestions.personas as unknown[])?.length || 0) + ")" }, { key: "competitors", label: "Competitors (" + ((fullAiSuggestions.competitors as unknown[])?.length || 0) + ")" }, { key: "brand", label: "Brand Identity" }].map(s => {
                      const checked = fullAiSections.includes(s.key);
                      return <label key={s.key} className={"flex items-center gap-3 p-3 rounded-lg border cursor-pointer " + (checked ? "border-[#4361ee] bg-blue-50/30" : "border-[var(--hm-border)]")}><input type="checkbox" checked={checked} onChange={() => setFullAiSections(checked ? fullAiSections.filter(x => x !== s.key) : [...fullAiSections, s.key])} /><span className="text-[13px] font-medium">{s.label}</span></label>;
                    })}
                  </div>
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setShowFullAI(false); setFullAiSuggestions(null); }} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
                    <button onClick={async () => {
                      setSaving(true);
                      await fetch("/api/knowledge/auto-populate", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ suggestions: fullAiSuggestions, sections: fullAiSections }) });
                      setSaving(false); setShowFullAI(false); setFullAiSuggestions(null); fetchAll(); setSaved("AI data imported!"); setTimeout(() => setSaved(""), 3000);
                    }} disabled={saving || fullAiSections.length === 0} className="h-8 px-5 bg-emerald-500 text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">{saving ? "Importing..." : "Import " + fullAiSections.length + " sections"}</button>
                  </div>
                </div>
              )}

              {aiError && <div className="p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-[12px] text-red-600 flex items-center justify-between">{aiError}<button onClick={() => setAiError("")} className="opacity-50 hover:opacity-100 transition-opacity duration-150 w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">&times;</button></div>}

              {/* Company */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-medium">Company Profile</h3>
                  <div className="flex items-center gap-2">
                    {editing === "company" && <AiBtn loading={aiLoading === "company"} onClick={() => aiSuggest("company", {}, (d) => setOrg({ ...org, ...(d as Partial<Org>) }))} />}
                    <button onClick={() => { setEditing(editing === "company" ? null : "company"); closeAll(); }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "company" ? "Cancel" : "Edit"}</button>
                  </div>
                </div>
                {editing === "company" ? (
                  <div className="space-y-3 animate-fade-in-fast">
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Description</label><textarea value={org.description || ""} onChange={e => setOrg({ ...org, description: e.target.value })} className="w-full text-[13px]" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Industry</label><input type="text" value={org.industry || ""} onChange={e => setOrg({ ...org, industry: e.target.value })} className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Size</label><input type="text" value={org.size || ""} onChange={e => setOrg({ ...org, size: e.target.value })} className="w-full text-[13px]" /></div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">HQ City</label><input type="text" value={org.hqCity || ""} onChange={e => setOrg({ ...org, hqCity: e.target.value })} className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">HQ Country</label><input type="text" value={org.hqCountry || ""} onChange={e => setOrg({ ...org, hqCountry: e.target.value })} className="w-full text-[13px]" /></div>
                    </div>
                    <button onClick={() => { saveEdit("company", org as unknown as Record<string, unknown>); setEditing(null); }} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {org.description && <p className="text-[12px] text-[var(--hm-text-secondary)] leading-relaxed mb-2">{org.description}</p>}
                    <div className="flex justify-between"><span className="text-[12px] text-[var(--hm-text-secondary)]">Industry</span><span className="text-[12px] text-[var(--hm-text-tertiary)]">{org.industry || "Not set"}</span></div>
                    <div className="flex justify-between"><span className="text-[12px] text-[var(--hm-text-secondary)]">Size</span><span className="text-[12px] text-[var(--hm-text-tertiary)]">{org.size || "Not set"}</span></div>
                    <div className="flex justify-between"><span className="text-[12px] text-[var(--hm-text-secondary)]">HQ</span><span className="text-[12px] text-[var(--hm-text-tertiary)]">{[org.hqCity, org.hqCountry].filter(Boolean).join(", ") || "Not set"}</span></div>
                  </div>
                )}
              </div>

              {/* Products */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 mb-3">
                <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-medium">Products ({products.length})</h3><button onClick={() => { setEditing(editing === "products" ? null : "products"); closeAll(); }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "products" ? "Done" : "Edit"}</button></div>
                {products.map(p => (
                  <div key={p.id}>
                    {editingItemId === p.id && editProd ? (
                      <div className="border border-[#4361ee] rounded-lg p-4 mb-2 space-y-3 animate-fade-in-fast">
                        <div className="flex justify-between items-start"><div className="flex-1"><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Name</label><input type="text" value={editProd.name} onChange={e => setEditProd({ ...editProd, name: e.target.value })} className="w-full text-[13px]" /></div><div className="ml-2 mt-4"><AiBtn loading={aiLoading === "product-edit"} onClick={() => aiSuggest("product", { name: editProd.name }, (d) => setEditProd({ ...editProd, ...(d as Partial<Product>) }))} /></div></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Description</label><textarea value={editProd.description} onChange={e => setEditProd({ ...editProd, description: e.target.value })} className="w-full text-[13px] min-h-[60px]" /></div>
                        <div className="grid grid-cols-3 gap-3">
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Category</label><select value={editProd.category} onChange={e => setEditProd({ ...editProd, category: e.target.value })} className="w-full text-[13px]"><option value="core">Core</option><option value="addon">Add-on</option><option value="service">Service</option><option value="module">Module</option></select></div>
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Classification</label><select value={editProd.classification} onChange={e => setEditProd({ ...editProd, classification: e.target.value })} className="w-full text-[13px]"><option value="">Select...</option><option value="painkiller">Painkiller</option><option value="vitamin">Vitamin</option></select></div>
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Scope</label><select value={editProd.scope} onChange={e => setEditProd({ ...editProd, scope: e.target.value })} className="w-full text-[13px]"><option value="global">Global</option><option value="specific">Specific</option></select></div>
                        </div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Target markets</label><MarketPicker markets={markets} selected={editProd.marketNames || []} onChange={v => setEditProd({ ...editProd, marketNames: v })} /></div>
                        <div className="flex justify-between"><button onClick={() => confirmAndDelete("product_delete", p.id, editProd?.name || p.id)} className="text-[11px] text-red-500 hover:underline hover:text-red-600 transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button><div className="flex gap-2"><button onClick={() => { setEditingItemId(null); setEditProd(null); }} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => saveEdit("product_update", { id: editProd.id, name: editProd.name, description: editProd.description, category: editProd.category, classification: editProd.classification, scope: editProd.scope, features: editProd.features, marketNames: editProd.marketNames || [] })} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button></div></div>
                      </div>
                    ) : (
                      <div className={"flex items-center justify-between py-2.5 border-b border-[var(--hm-border)] last:border-b-0 " + (editing === "products" ? "cursor-pointer hover:bg-[var(--hm-bg-secondary)] rounded-lg px-2 -mx-2" : "")} onClick={() => { if (editing === "products") { setEditingItemId(p.id); setEditProd({ ...p }); } }}>
                        <div><p className="text-[12px] font-medium">{p.name}</p>{p.description && <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5 max-w-[400px] leading-relaxed">{p.description.slice(0, 100)}{p.description.length > 100 ? "..." : ""}</p>}</div>
                        <div className="flex items-center gap-2">{p.classification && <span className="text-[10px] px-2 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md capitalize">{p.classification}</span>}<span className="text-[10px] px-2 py-0.5 bg-blue-50 text-[#4361ee] rounded-md">{p.scope === "global" ? "Global" : "Specific"}</span>{editing === "products" && <span className="text-[10px] text-[#4361ee]">&#9998;</span>}</div>
                      </div>
                    )}
                  </div>
                ))}
                {products.length === 0 && editing !== "products" && <p className="text-[12px] text-[var(--hm-text-tertiary)] py-2">No products added yet — click Edit to add your first product.</p>}
                {editing === "products" && !showAddProduct && !editingItemId && <button onClick={() => setShowAddProduct(true)} className="mt-3 w-full h-9 border-2 border-dashed border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-tertiary)] hover:border-[#4361ee] hover:text-[#4361ee]">+ Add product</button>}
                {showAddProduct && (
                  <div className="mt-3 border border-[var(--hm-border)] rounded-lg p-4 space-y-3 animate-fade-in-fast">
                    <div className="flex justify-between items-start"><div className="flex-1"><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Name *</label><input type="text" value={newProd.name} onChange={e => setNewProd({ ...newProd, name: e.target.value })} placeholder="e.g., Carrier Allocation Engine" className="w-full text-[13px]" /></div><div className="ml-2 mt-4"><AiBtn loading={aiLoading === "product"} onClick={() => aiSuggest("product", { name: newProd.name }, (d) => setNewProd({ ...newProd, ...(d as Record<string, string & string[]>) }))} /></div></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Description</label><textarea value={newProd.description} onChange={e => setNewProd({ ...newProd, description: e.target.value })} className="w-full text-[13px] min-h-[60px]" /></div>
                    <div className="grid grid-cols-3 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Category</label><select value={newProd.category} onChange={e => setNewProd({ ...newProd, category: e.target.value })} className="w-full text-[13px]"><option value="core">Core</option><option value="addon">Add-on</option><option value="service">Service</option><option value="module">Module</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Classification</label><select value={newProd.classification} onChange={e => setNewProd({ ...newProd, classification: e.target.value })} className="w-full text-[13px]"><option value="">Select...</option><option value="painkiller">Painkiller</option><option value="vitamin">Vitamin</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Scope</label><select value={newProd.scope} onChange={e => setNewProd({ ...newProd, scope: e.target.value })} className="w-full text-[13px]"><option value="global">Global</option><option value="specific">Specific</option></select></div>
                    </div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Target markets</label><MarketPicker markets={markets} selected={newProd.marketNames} onChange={v => setNewProd({ ...newProd, marketNames: v })} /></div>
                    <div className="flex justify-end gap-2"><button onClick={() => setShowAddProduct(false)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => { if (newProd.name) { saveEdit("product_add", { ...newProd }); setNewProd({ name: "", description: "", category: "core", classification: "", scope: "global", features: [], marketNames: [] }); setShowAddProduct(false); } }} disabled={!newProd.name || saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Add"}</button></div>
                  </div>
                )}
              </div>

              {/* Markets */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 mb-3">
                <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-medium">Markets ({markets.length})</h3><button onClick={() => { setEditing(editing === "markets" ? null : "markets"); closeAll(); setEditMarket(null); setNewMarket({ name: "", notes: "" }); }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "markets" ? "Done" : "Edit"}</button></div>
                {markets.map(m => (
                  <div key={m.id}>
                    {editing === "markets" && editMarket?.id === m.id ? (
                      <div className="border border-[#4361ee] rounded-lg p-4 mb-2 space-y-3 animate-fade-in-fast">
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Name</label><input type="text" value={editMarket.name} onChange={e => setEditMarket({ ...editMarket, name: e.target.value })} className="w-full text-[13px]" /></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Notes (optional)</label><input type="text" value={editMarket.notes} onChange={e => setEditMarket({ ...editMarket, notes: e.target.value })} className="w-full text-[13px]" /></div>
                        <div className="flex justify-between">
                          <button onClick={() => confirmAndDelete("market_delete", m.id, editMarket?.name || m.name)} className="text-[11px] text-red-500 hover:underline hover:text-red-600 transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button>
                          <div className="flex gap-2">
                            <button onClick={() => setEditMarket(null)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
                            <button onClick={async () => { if (!editMarket.name.trim()) return; await fetch("/api/knowledge/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "market_update", id: editMarket.id, name: editMarket.name, notes: editMarket.notes }) }); setEditMarket(null); fetchAll(); setSaved("Market updated!"); setTimeout(() => setSaved(""), 2000); }} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={"flex items-center justify-between py-2.5 border-b border-[var(--hm-border)] last:border-b-0 " + (editing === "markets" ? "cursor-pointer hover:bg-[var(--hm-bg-secondary)] rounded-lg px-2 -mx-2" : "")} onClick={() => { if (editing === "markets" && editMarket?.id !== m.id) { setEditMarket({ id: m.id, name: m.name, notes: (m as Market & { notes?: string }).notes || "" }); } }}>
                        <div className="flex items-center gap-2">
                          <span className={"inline-flex items-center px-2.5 py-1 rounded-md text-[12px] " + (m.type === "primary" ? "bg-[#4361ee] text-white" : "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-secondary)]")}>{m.name}</span>
                        </div>
                        {editing === "markets" && <span className="text-[10px] text-[#4361ee]">&#9998;</span>}
                      </div>
                    )}
                  </div>
                ))}
                {markets.length === 0 && editing !== "markets" && <p className="text-[12px] text-[var(--hm-text-tertiary)] py-2">No markets defined yet — click Edit to add your first market.</p>}
                {editing === "markets" && !editMarket && (
                  <div className="mt-3 border border-dashed border-[var(--hm-border)] rounded-lg p-4 space-y-3 animate-fade-in-fast">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Market name *</label><input type="text" placeholder="e.g., Enterprise SaaS" value={newMarket.name} onChange={e => setNewMarket({ ...newMarket, name: e.target.value })} className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Notes (optional)</label><input type="text" placeholder="Any context" value={newMarket.notes} onChange={e => setNewMarket({ ...newMarket, notes: e.target.value })} className="w-full text-[13px]" /></div>
                    </div>
                    <div className="flex justify-end">
                      <button onClick={async () => { if (!newMarket.name.trim()) return; await fetch("/api/knowledge/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "market_add", name: newMarket.name, notes: newMarket.notes }) }); setNewMarket({ name: "", notes: "" }); fetchAll(); setSaved("Market added!"); setTimeout(() => setSaved(""), 2000); }} disabled={!newMarket.name.trim() || saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">Add market</button>
                    </div>
                  </div>
                )}
              </div>

              {/* Personas */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 mb-3">
                <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-medium">Personas ({personas.length})</h3><button onClick={() => { setEditing(editing === "personas" ? null : "personas"); closeAll(); }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "personas" ? "Done" : "Edit"}</button></div>
                {personas.map(p => (
                  <div key={p.id}>
                    {editingItemId === p.id && editPersona ? (
                      <div className="border border-[#4361ee] rounded-lg p-4 mb-2 space-y-3 animate-fade-in-fast">
                        <div className="flex justify-between items-end"><div className="grid grid-cols-3 gap-3 flex-1">
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Title</label><input type="text" value={editPersona.title} onChange={e => setEditPersona({ ...editPersona, title: e.target.value })} className="w-full text-[13px]" /></div>
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Department</label><input type="text" value={editPersona.department} onChange={e => setEditPersona({ ...editPersona, department: e.target.value })} className="w-full text-[13px]" /></div>
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Seniority</label><select value={editPersona.seniority} onChange={e => setEditPersona({ ...editPersona, seniority: e.target.value })} className="w-full text-[13px]"><option value="">Select...</option><option value="C-Suite / VP">C-Suite / VP</option><option value="Director">Director</option><option value="Head of">Head of</option><option value="Manager">Manager</option><option value="IC">IC</option></select></div>
                        </div><div className="ml-2"><AiBtn loading={aiLoading === "persona-edit"} onClick={() => aiSuggest("persona", { title: editPersona.title }, (d) => setEditPersona({ ...editPersona, ...(d as Partial<Persona>) }))} /></div></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Pain points</label><textarea value={editPersona.painPoints} onChange={e => setEditPersona({ ...editPersona, painPoints: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">How we help</label><textarea value={editPersona.howWeHelp} onChange={e => setEditPersona({ ...editPersona, howWeHelp: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                        <div className="flex justify-between"><button onClick={() => confirmAndDelete("persona_delete", p.id, editPersona?.title || p.id)} className="text-[11px] text-red-500 hover:underline hover:text-red-600 transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button><div className="flex gap-2"><button onClick={() => { setEditingItemId(null); setEditPersona(null); }} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => saveEdit("persona_update", { id: editPersona.id, title: editPersona.title, department: editPersona.department, seniority: editPersona.seniority, painPoints: editPersona.painPoints, howWeHelp: editPersona.howWeHelp, contentPrefs: editPersona.contentPrefs })} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button></div></div>
                      </div>
                    ) : (
                      <div className={"flex items-center justify-between py-2.5 border-b border-[var(--hm-border)] last:border-b-0 " + (editing === "personas" ? "cursor-pointer hover:bg-[var(--hm-bg-secondary)] rounded-lg px-2 -mx-2" : "")} onClick={() => { if (editing === "personas") { setEditingItemId(p.id); setEditPersona({ ...p }); } }}>
                        <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-[#4361ee]">{p.title.split(" ").map(w => w[0]).join("").slice(0, 2)}</div><div><p className="text-[12px] font-medium">{p.title}</p><p className="text-[11px] text-[var(--hm-text-tertiary)]">{[p.seniority, p.department].filter(Boolean).join(" · ")}</p></div></div>
                        {editing === "personas" && <span className="text-[10px] text-[#4361ee]">&#9998;</span>}
                      </div>
                    )}
                  </div>
                ))}
                {personas.length === 0 && editing !== "personas" && <p className="text-[12px] text-[var(--hm-text-tertiary)] py-2">No personas defined yet — click Edit to add buyer profiles.</p>}
                {editing === "personas" && !showAddPersona && !editingItemId && <button onClick={() => setShowAddPersona(true)} className="mt-3 w-full h-9 border-2 border-dashed border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-tertiary)] hover:border-[#4361ee] hover:text-[#4361ee]">+ Add persona</button>}
                {showAddPersona && (
                  <div className="mt-3 border border-[var(--hm-border)] rounded-lg p-4 space-y-3 animate-fade-in-fast">
                    <div className="flex justify-between items-end"><div className="grid grid-cols-3 gap-3 flex-1">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Title *</label><input type="text" value={newPersona.title} onChange={e => setNewPersona({ ...newPersona, title: e.target.value })} placeholder="e.g., VP of Operations" className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Department</label><input type="text" value={newPersona.department} onChange={e => setNewPersona({ ...newPersona, department: e.target.value })} className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Seniority</label><select value={newPersona.seniority} onChange={e => setNewPersona({ ...newPersona, seniority: e.target.value })} className="w-full text-[13px]"><option value="">Select...</option><option value="C-Suite / VP">C-Suite / VP</option><option value="Director">Director</option><option value="Head of">Head of</option><option value="Manager">Manager</option><option value="IC">IC</option></select></div>
                    </div><div className="ml-2"><AiBtn loading={aiLoading === "persona"} onClick={() => aiSuggest("persona", { title: newPersona.title }, (d) => setNewPersona({ ...newPersona, ...(d as Record<string, string>) }))} /></div></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Pain points</label><textarea value={newPersona.painPoints} onChange={e => setNewPersona({ ...newPersona, painPoints: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">How we help</label><textarea value={newPersona.howWeHelp} onChange={e => setNewPersona({ ...newPersona, howWeHelp: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                    <div className="flex justify-end gap-2"><button onClick={() => setShowAddPersona(false)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => { if (newPersona.title) { saveEdit("persona_add", { ...newPersona, contentPrefs: [] }); setNewPersona({ title: "", department: "", seniority: "", painPoints: "", howWeHelp: "" }); setShowAddPersona(false); } }} disabled={!newPersona.title || saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Add"}</button></div>
                  </div>
                )}
              </div>

              {/* Competitors */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5 mb-3">
                <div className="flex items-center justify-between mb-3"><h3 className="text-[14px] font-medium">Competitors ({competitors.length})</h3><button onClick={() => { setEditing(editing === "competitors" ? null : "competitors"); closeAll(); }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "competitors" ? "Done" : "Edit"}</button></div>
                {competitors.map(c => (
                  <div key={c.id}>
                    {editingItemId === c.id && editComp ? (
                      <div className="border border-[#4361ee] rounded-lg p-4 mb-2 space-y-3 animate-fade-in-fast">
                        <div className="flex justify-between items-start"><div className="grid grid-cols-2 gap-3 flex-1">
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Name</label><input type="text" value={editComp.name} onChange={e => setEditComp({ ...editComp, name: e.target.value })} className="w-full text-[13px]" /></div>
                          <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Website</label><input type="text" value={editComp.website} onChange={e => setEditComp({ ...editComp, website: e.target.value })} className="w-full text-[13px]" /></div>
                        </div><div className="ml-2 mt-4"><AiBtn loading={aiLoading === "competitor-edit"} onClick={() => aiSuggest("competitor", { name: editComp.name }, (d) => setEditComp({ ...editComp, ...(d as Partial<Competitor>) }))} /></div></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Their positioning</label><textarea value={editComp.positioning} onChange={e => setEditComp({ ...editComp, positioning: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">How we differentiate</label><textarea value={editComp.differentiator} onChange={e => setEditComp({ ...editComp, differentiator: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                        <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Markets they compete in</label><MarketPicker markets={markets} selected={editComp.marketOverlap} onChange={v => setEditComp({ ...editComp, marketOverlap: v })} /></div>
                        <div className="flex justify-between"><button onClick={() => confirmAndDelete("competitor_delete", c.id, editComp?.name || c.id)} className="text-[11px] text-red-500 hover:underline hover:text-red-600 transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button><div className="flex gap-2"><button onClick={() => { setEditingItemId(null); setEditComp(null); }} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => saveEdit("competitor_update", { id: editComp.id, name: editComp.name, website: editComp.website, positioning: editComp.positioning, differentiator: editComp.differentiator, marketOverlap: editComp.marketOverlap })} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button></div></div>
                      </div>
                    ) : (
                      <div className={"flex items-center justify-between py-2.5 border-b border-[var(--hm-border)] last:border-b-0 " + (editing === "competitors" ? "cursor-pointer hover:bg-[var(--hm-bg-secondary)] rounded-lg px-2 -mx-2" : "")} onClick={() => { if (editing === "competitors") { setEditingItemId(c.id); setEditComp({ ...c }); } }}>
                        <div className="flex items-center gap-2.5"><div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-[13px] font-medium text-red-600">{c.name[0]}</div><div><p className="text-[12px] font-medium">{c.name}</p>{c.website && <p className="text-[11px] text-[var(--hm-text-tertiary)]">{c.website}</p>}{c.marketOverlap.length > 0 && <div className="flex flex-wrap gap-1 mt-1">{c.marketOverlap.map((m, i) => <span key={i} className="text-[9px] px-1.5 py-0.5 bg-blue-50 text-[#4361ee] rounded-md">{m}</span>)}</div>}</div></div>
                        {editing === "competitors" && <span className="text-[10px] text-[#4361ee]">&#9998;</span>}
                      </div>
                    )}
                  </div>
                ))}
                {competitors.length === 0 && editing !== "competitors" && <p className="text-[12px] text-[var(--hm-text-tertiary)] py-2">No competitors tracked yet — click Edit to add competitors.</p>}
                {editing === "competitors" && !showAddCompetitor && !editingItemId && <button onClick={() => setShowAddCompetitor(true)} className="mt-3 w-full h-9 border-2 border-dashed border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-tertiary)] hover:border-[#4361ee] hover:text-[#4361ee]">+ Add competitor</button>}
                {showAddCompetitor && (
                  <div className="mt-3 border border-[var(--hm-border)] rounded-lg p-4 space-y-3 animate-fade-in-fast">
                    <div className="flex justify-between items-start"><div className="grid grid-cols-2 gap-3 flex-1">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Name *</label><input type="text" value={newComp.name} onChange={e => setNewComp({ ...newComp, name: e.target.value })} placeholder="e.g., Narvar" className="w-full text-[13px]" /></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Website</label><input type="text" value={newComp.website} onChange={e => setNewComp({ ...newComp, website: e.target.value })} className="w-full text-[13px]" /></div>
                    </div><div className="ml-2 mt-4"><AiBtn loading={aiLoading === "competitor"} onClick={() => aiSuggest("competitor", { name: newComp.name }, (d) => setNewComp({ ...newComp, ...(d as Record<string, string & string[]>) }))} /></div></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Their positioning</label><textarea value={newComp.positioning} onChange={e => setNewComp({ ...newComp, positioning: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">How we differentiate</label><textarea value={newComp.differentiator} onChange={e => setNewComp({ ...newComp, differentiator: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1">Markets they compete in</label><MarketPicker markets={markets} selected={newComp.marketOverlap} onChange={v => setNewComp({ ...newComp, marketOverlap: v })} /></div>
                    <div className="flex justify-end gap-2"><button onClick={() => setShowAddCompetitor(false)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button><button onClick={() => { if (newComp.name) { saveEdit("competitor_add", { ...newComp }); setNewComp({ name: "", website: "", positioning: "", differentiator: "", marketOverlap: [] }); setShowAddCompetitor(false); } }} disabled={!newComp.name || saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Add"}</button></div>
                  </div>
                )}
              </div>

              {/* Brand */}
              <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-[14px] font-medium">Brand Identity</h3>
                  <div className="flex items-center gap-2">
                    {editing === "brand" && <AiBtn loading={aiLoading === "brand"} onClick={() => aiSuggest("brand", {}, (d) => setEditBrand(eb => ({ ...(eb || brand || { traits: [], archetype: "", toneFormal: 50, toneTechnical: 50, toneSerious: 50, toneCorporate: 50, voiceDescription: "", wordsWeUse: [], wordsWeAvoid: [], competitiveMoat: "" }), ...(d as Partial<Brand>) })))} />}
                    <button onClick={() => { if (editing === "brand") { setEditing(null); setEditBrand(null); } else { closeAll(); setEditing("brand"); setEditBrand(brand ? { ...brand } : { traits: [], archetype: "", toneFormal: 50, toneTechnical: 50, toneSerious: 50, toneCorporate: 50, voiceDescription: "", wordsWeUse: [], wordsWeAvoid: [], competitiveMoat: "" }); } }} className="text-[11px] text-[#4361ee] hover:underline transition-colors duration-150 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">{editing === "brand" ? "Cancel" : "Edit"}</button>
                  </div>
                </div>
                {editing === "brand" && editBrand ? (
                  <div className="space-y-3 animate-fade-in-fast">
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Archetype</label><select value={editBrand.archetype || ""} onChange={e => setEditBrand({ ...editBrand, archetype: e.target.value })} className="w-full text-[13px]"><option value="">Select archetype...</option><option value="The Innocent">The Innocent — Optimism, simplicity, goodness</option><option value="The Sage">The Sage — Wisdom, expertise, truth-seeking</option><option value="The Explorer">The Explorer — Freedom, discovery, ambition</option><option value="The Outlaw">The Outlaw — Disruption, liberation, revolution</option><option value="The Magician">The Magician — Transformation, vision, moments</option><option value="The Hero">The Hero — Courage, achievement, mastery</option><option value="The Lover">The Lover — Passion, intimacy, commitment</option><option value="The Jester">The Jester — Humor, joy, irreverence</option><option value="The Everyman">The Everyman — Belonging, relatability, trust</option><option value="The Caregiver">The Caregiver — Service, generosity, protection</option><option value="The Ruler">The Ruler — Control, leadership, stability</option><option value="The Creator">The Creator — Innovation, vision, originality</option></select></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Traits (comma-separated)</label><input type="text" value={editBrand.traits.join(", ")} onChange={e => setEditBrand({ ...editBrand, traits: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })} placeholder="e.g., Bold, Clear, Expert" className="w-full text-[13px]" /></div>
                    </div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Voice description</label><textarea value={editBrand.voiceDescription || ""} onChange={e => setEditBrand({ ...editBrand, voiceDescription: e.target.value })} className="w-full text-[13px] min-h-[60px]" /></div>
                    <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Competitive moat</label><textarea value={editBrand.competitiveMoat || ""} onChange={e => setEditBrand({ ...editBrand, competitiveMoat: e.target.value })} className="w-full text-[13px] min-h-[52px]" /></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Words we use <span className="font-normal opacity-60">(Enter to add)</span></label><div className="flex flex-wrap gap-1 p-1.5 border border-[var(--hm-border)] rounded-lg min-h-[34px] bg-white">{editBrand.wordsWeUse.map((w,i)=><span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">{w}<button type="button" onClick={()=>setEditBrand({...editBrand,wordsWeUse:editBrand.wordsWeUse.filter((_,j)=>j!==i)})} className="hover:text-red-500 font-bold">&times;</button></span>)}<input type="text" placeholder={editBrand.wordsWeUse.length===0?"e.g. precise":""} className="border-none outline-none text-[12px] bg-transparent min-w-[80px] flex-1 p-0 focus:ring-0" onKeyDown={e=>{if((e.key==="Enter"||e.key===",")&&(e.target as HTMLInputElement).value.trim()){e.preventDefault();const v=(e.target as HTMLInputElement).value.trim().replace(/,$/,"");if(v)setEditBrand({...editBrand,wordsWeUse:[...editBrand.wordsWeUse,v]});(e.target as HTMLInputElement).value="";}}} /></div></div>
                      <div><label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Words we avoid <span className="font-normal opacity-60">(Enter to add)</span></label><div className="flex flex-wrap gap-1 p-1.5 border border-[var(--hm-border)] rounded-lg min-h-[34px] bg-white">{editBrand.wordsWeAvoid.map((w,i)=><span key={i} className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">{w}<button type="button" onClick={()=>setEditBrand({...editBrand,wordsWeAvoid:editBrand.wordsWeAvoid.filter((_,j)=>j!==i)})} className="hover:text-red-800 font-bold">&times;</button></span>)}<input type="text" placeholder={editBrand.wordsWeAvoid.length===0?"e.g. leverage":""} className="border-none outline-none text-[12px] bg-transparent min-w-[80px] flex-1 p-0 focus:ring-0" onKeyDown={e=>{if((e.key==="Enter"||e.key===",")&&(e.target as HTMLInputElement).value.trim()){e.preventDefault();const v=(e.target as HTMLInputElement).value.trim().replace(/,$/,"");if(v)setEditBrand({...editBrand,wordsWeAvoid:[...editBrand.wordsWeAvoid,v]});(e.target as HTMLInputElement).value="";}}} /></div></div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-xs text-[var(--hm-text-secondary)] font-medium">Tone sliders</label>
                      {([{ key: "toneFormal" as keyof Brand, left: "Formal", right: "Casual" }, { key: "toneTechnical" as keyof Brand, left: "Technical", right: "Simple" }, { key: "toneSerious" as keyof Brand, left: "Serious", right: "Playful" }, { key: "toneCorporate" as keyof Brand, left: "Corporate", right: "Human" }] as { key: keyof Brand; left: string; right: string }[]).map(({ key, left, right }) => (
                        <div key={key as string}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] text-[var(--hm-text-secondary)] font-medium">{left} <span className="opacity-40">↔</span> {right}</span>
                            <span className="text-[11px] font-semibold tabular-nums text-[#4361ee] bg-blue-50 px-1.5 py-0.5 rounded">{editBrand[key] as number}</span>
                          </div>
                          <input type="range" min={0} max={100} value={editBrand[key] as number} onChange={e => setEditBrand({ ...editBrand, [key]: parseInt(e.target.value) })} className="w-full" />
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-end">
                      <button onClick={() => { saveEdit("brand", editBrand as unknown as Record<string, unknown>); setEditing(null); setEditBrand(null); }} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button>
                    </div>
                  </div>
                ) : brand ? (<div className="space-y-1.5">
                  <div className="flex justify-between"><span className="text-[12px] text-[var(--hm-text-secondary)]">Archetype</span><span className="text-[12px] text-[var(--hm-text-tertiary)]">{brand.archetype || "Not set"}</span></div>
                  <div className="flex justify-between"><span className="text-[12px] text-[var(--hm-text-secondary)]">Traits</span><span className="text-[12px] text-[var(--hm-text-tertiary)]">{brand.traits.join(", ") || "None"}</span></div>
                  {brand.voiceDescription && <p className="text-[12px] text-[var(--hm-text-secondary)] leading-relaxed mt-1">{brand.voiceDescription}</p>}
                  {brand.wordsWeUse.length > 0 && <div className="mt-2"><p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium mb-1">Words we use</p><div className="flex flex-wrap gap-1">{brand.wordsWeUse.map((w, i) => <span key={i} className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-100 rounded-full">{w}</span>)}</div></div>}
                  {brand.wordsWeAvoid.length > 0 && <div className="mt-2"><p className="text-[10px] text-[var(--hm-text-tertiary)] uppercase tracking-wide font-medium mb-1">Words we avoid</p><div className="flex flex-wrap gap-1">{brand.wordsWeAvoid.map((w, i) => <span key={i} className="text-[10px] px-2 py-0.5 bg-red-50 text-red-500 border border-red-100 rounded-full">{w}</span>)}</div></div>}
                </div>) : <p className="text-[12px] text-[var(--hm-text-tertiary)]">Not configured — click Edit to set up brand identity</p>}
              </div>
            </div>
          )}

          {/* Documents Tab */}
          {tab === "documents" && (
            <div className="animate-fade-in max-w-[720px]">
              <div className="flex items-center justify-between mb-1">
                <div><h3 className="text-[15px] font-medium">Knowledge documents</h3><p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Upload any document — AI will extract learnings and add them to the learning log</p></div>
              </div>

              {docError && <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-[12px] text-red-600 flex items-center justify-between animate-fade-in"><span>{docError}</span><button onClick={() => setDocError("")} className="opacity-50 hover:opacity-100 transition-opacity duration-150 w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400">&times;</button></div>}

              {/* Upload zone */}
              <label
                className={"mt-4 flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all " + (docUploading ? "border-[#4361ee] bg-blue-50/40 cursor-default" : dragOver ? "border-[#4361ee] bg-blue-50/30" : "border-[var(--hm-border)] hover:border-[#4361ee] hover:bg-blue-50/20")}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); if (!docUploading && e.dataTransfer.files.length) uploadDocuments(e.dataTransfer.files); }}
              >
                <input type="file" className="hidden" disabled={docUploading} multiple accept=".pdf,.txt,.md,.csv,.html,.htm,.json,.docx,.pptx,.xlsx" onChange={e => { if (e.target.files?.length) uploadDocuments(e.target.files); e.target.value = ""; }} />
                {docUploading ? (
                  <div role="status" aria-label="Uploading and analyzing documents" className="flex flex-col items-center gap-2">
                    <div aria-hidden="true" className="w-6 h-6 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />
                    <p className="text-[12px] text-[#4361ee] font-medium">
                      {docProgress ? `Analyzing ${docProgress.total} document${docProgress.total !== 1 ? "s" : ""}...` : "Analyzing..."}
                    </p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)]">AI is extracting learnings — this may take a moment</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2">
                    <div className={"w-10 h-10 rounded-full flex items-center justify-center transition-all " + (dragOver ? "bg-[#4361ee]/20" : "bg-gradient-to-br from-[#4361ee]/10 to-[#7c3aed]/10")}>
                      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3v12M7 8l5-5 5 5" stroke="#4361ee" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 17v2a2 2 0 002 2h14a2 2 0 002-2v-2" stroke="#4361ee" strokeWidth="1.8" strokeLinecap="round"/></svg>
                    </div>
                    <p className="text-[13px] font-medium text-[var(--hm-text-secondary)]">{dragOver ? "Drop files here" : "Drag & drop or click to upload"}</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)]">PDF, TXT, MD, CSV, HTML, JSON, DOCX, PPTX, XLSX &nbsp;·&nbsp; Multiple files supported</p>
                  </div>
                )}
              </label>

              <div className="mt-3 p-3 bg-gradient-to-r from-[#4361ee]/5 to-[#7c3aed]/5 border border-[#4361ee]/20 rounded-lg flex items-start gap-2.5">
                <div className="w-5 h-5 rounded-full bg-gradient-to-br from-[#4361ee] to-[#7c3aed] flex items-center justify-center flex-shrink-0 mt-0.5"><svg width="9" height="9" viewBox="0 0 32 32"><path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#fff" strokeWidth="2.5" /></svg></div>
                <p className="text-[11px] text-[var(--hm-text-secondary)] leading-[1.6]">Documents are analyzed by AI and their insights are automatically added to your learning log and context engine — making future content generation and AI assistant responses more accurate and brand-aligned.</p>
              </div>

              {/* Documents list */}
              {docs.length > 0 && (
                <div className="mt-5">
                  <p className="text-[12px] font-medium text-[var(--hm-text-secondary)] mb-3">{docs.length} document{docs.length !== 1 ? "s" : ""} uploaded</p>
                  <div className="space-y-2">
                    {docs.map(doc => {
                      const extColors: Record<string, string> = { pdf: "bg-red-50 text-red-600", txt: "bg-gray-50 text-gray-600", md: "bg-gray-50 text-gray-600", csv: "bg-emerald-50 text-emerald-600", json: "bg-amber-50 text-amber-600", html: "bg-orange-50 text-orange-600", docx: "bg-blue-50 text-blue-600", pptx: "bg-orange-50 text-orange-600", xlsx: "bg-emerald-50 text-emerald-600" };
                      const ec = extColors[doc.fileType] || "bg-gray-50 text-gray-600";
                      return (
                        <div key={doc.id} className="flex items-center gap-3 p-3.5 bg-white border border-[var(--hm-border)] rounded-xl">
                          <div className={"w-9 h-9 rounded-lg flex items-center justify-center text-[10px] font-bold uppercase " + ec}>{doc.fileType}</div>
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium truncate">{doc.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="text-[10px] text-[var(--hm-text-tertiary)]">{doc.fileSize ? (doc.fileSize / 1024 < 1024 ? Math.round(doc.fileSize / 1024) + " KB" : (doc.fileSize / 1024 / 1024).toFixed(1) + " MB") : "—"}</span>
                              <span className="text-[10px] text-[var(--hm-text-tertiary)]">·</span>
                              <span className="text-[10px] text-[var(--hm-text-tertiary)]">{new Date(doc.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {doc.status === "analyzed" && <span className="text-[10px] px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-md">{doc.learningsCount} learning{doc.learningsCount !== 1 ? "s" : ""}</span>}
                            {doc.status === "processing" && <span className="text-[10px] px-2 py-0.5 bg-amber-50 text-amber-600 rounded-md">Processing</span>}
                            {doc.status === "failed" && <span className="text-[10px] px-2 py-0.5 bg-red-50 text-red-600 rounded-md">Failed</span>}
                            <button onClick={() => deleteDocument(doc.id)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50 active:bg-red-100 text-[var(--hm-text-tertiary)] hover:text-red-500 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400" title="Remove document">
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 9h8l1-9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => setTab("learning")} className="mt-4 w-full h-9 border border-[var(--hm-border)] rounded-lg text-[12px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">View learning log &rarr;</button>
                </div>
              )}

              {docs.length === 0 && !docUploading && (
                <div className="mt-5 bg-white border border-[var(--hm-border)] rounded-xl p-8 text-center">
                  <p className="text-[13px] font-medium mb-1">No documents yet</p>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)]">Upload brand guidelines, product specs, case studies, or any other documents to instantly enrich the AI's context</p>
                </div>
              )}
            </div>
          )}

          {/* Skills Tab — 3-column layout */}
          {tab === "skills" && (() => {
            const NAV_GROUPS = [
              { key: "synthesized", label: "Learned skills", icon: "✦", accent: true },
              { key: "writing",     label: "Writing",        icon: "✍" },
              { key: "brand_design",label: "Brand & design", icon: "🎨" },
              { key: "ai_behavior", label: "AI behavior",    icon: "⚡" },
              { key: "seo",         label: "SEO",            icon: "🔍" },
            ];
            const activeGroup = activeSkillGroup;
            const setActiveGroup = (v: string) => { setActiveSkillGroup(v); setEditingSkill(null); setShowAddSkill(false); };
            const groupSkills = (key: string) => key === "synthesized"
              ? skills.filter(s => s.linkedFeature === "synthesized")
              : skills.filter(s => s.category === key && s.linkedFeature !== "synthesized");
            const visibleSkills = groupSkills(activeGroup);

            const downloadAllMd = () => {
              const lines: string[] = [
                `# ${org?.name || "HiveMind"} — Skills`,
                `_Generated ${new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}_`,
                "",
              ];
              const sections = [
                { title: "✦ Learned Skills (Auto-synthesized)", key: "synthesized" },
                { title: "Writing Skills", key: "writing" },
                { title: "Brand & Design Skills", key: "brand_design" },
                { title: "AI Behavior Skills", key: "ai_behavior" },
                { title: "SEO Skills", key: "seo" },
              ];
              for (const sec of sections) {
                const items = groupSkills(sec.key);
                if (!items.length) continue;
                lines.push(`---`, ``, `## ${sec.title}`, ``);
                for (const s of items) {
                  lines.push(`### ${s.name}`);
                  if (s.description) lines.push(`> ${s.description}`, ``);
                  if (sec.key !== "synthesized") lines.push(`**Feature:** ${fl(s.linkedFeature)}`, ``);
                  lines.push(s.instructions, ``);
                }
              }
              const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
              a.download = `${(org?.name || "hivemind").replace(/\s+/g, "-").toLowerCase()}-skills.md`;
              a.click(); URL.revokeObjectURL(a.href);
            };

            const downloadOneMd = (s: Skill) => {
              const lines = [
                `# ${s.name}`,
                ``,
                s.description ? `> ${s.description}\n` : "",
                `**Category:** ${s.category} | **Feature:** ${fl(s.linkedFeature)}`,
                ``,
                `---`,
                ``,
                s.instructions,
              ];
              const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
              const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
              a.download = `${s.name.replace(/\s+/g, "-").toLowerCase()}.md`;
              a.click(); URL.revokeObjectURL(a.href);
            };

            return (
              <div className="animate-fade-in flex-1 flex flex-col overflow-hidden p-7">
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-[15px] font-medium">Platform skills</h3>
                    <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Instructions HiveMind follows across all features</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Hidden file input for .md import */}
                    <input ref={skillImportRef} type="file" accept=".md,text/markdown" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) importSkillsMd(f); }} />
                    <button onClick={downloadAllMd} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] flex items-center gap-1.5 hover:border-[#4361ee] hover:text-[#4361ee] transition-all">
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                      Export .md
                    </button>
                    <button onClick={() => skillImportRef.current?.click()} disabled={importingSkills} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] flex items-center gap-1.5 hover:border-[#4361ee] hover:text-[#4361ee] transition-all disabled:opacity-50 disabled:cursor-not-allowed">
                      {importingSkills
                        ? <><span className="w-3 h-3 border-[1.5px] border-current/30 border-t-current rounded-full animate-spin" />Importing…</>
                        : <><svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 14V6M5 9l3-3 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>Import .md</>
                      }
                    </button>
                    <button onClick={() => { setShowAddSkill(true); setEditingSkill(null); }} className="h-8 px-3.5 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">+ Add skill</button>
                  </div>
                </div>

                {importResult && (
                  <div className="mb-3 p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#10b981" strokeWidth="1.2"/><path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <p className="text-[11px] text-emerald-700">{importResult.imported} skill{importResult.imported !== 1 ? "s" : ""} imported{importResult.skipped > 0 ? ` · ${importResult.skipped} skipped (already exist)` : ""}.</p>
                  </div>
                )}
                {importError && (
                  <div className="mb-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center justify-between gap-2">
                    <p className="text-[11px] text-red-600">{importError}</p>
                    <button onClick={() => setImportError("")} className="text-red-400 hover:text-red-600 text-[12px]">✕</button>
                  </div>
                )}
                {synthResult && (
                  <div className="mb-3 p-3 bg-emerald-50 border border-emerald-100 rounded-lg flex items-center gap-2">
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#10b981" strokeWidth="1.2"/><path d="M5 8l2 2 4-4" stroke="#10b981" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    <p className="text-[11px] text-emerald-700">{synthResult.synthesized} skills synthesized — {synthResult.categories.map(c => `${c.name} (${c.count})`).join(", ")}</p>
                  </div>
                )}

                {/* 3-column body */}
                <div className="flex-1 flex gap-0 border border-[var(--hm-border)] rounded-xl overflow-hidden bg-white min-h-0">

                  {/* Col 1 — Category nav */}
                  <div className="w-[190px] flex-shrink-0 border-r border-[var(--hm-border)] bg-[var(--hm-bg-secondary)] flex flex-col">
                    <div className="p-3 border-b border-[var(--hm-border)]">
                      <p className="text-[10px] font-semibold text-[var(--hm-text-tertiary)] uppercase tracking-wider">Categories</p>
                    </div>
                    <div className="flex-1 p-2 space-y-0.5">
                      {NAV_GROUPS.map(g => {
                        const count = groupSkills(g.key).length;
                        const isActive = activeGroup === g.key;
                        return (
                          <button
                            key={g.key}
                            onClick={() => setActiveGroup(g.key)}
                            className={"w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-all " + (isActive ? (g.accent ? "bg-violet-100 text-violet-700" : "bg-white shadow-sm text-[var(--hm-text-primary)]") : "text-[var(--hm-text-secondary)] hover:bg-white/60")}
                          >
                            <span className="flex items-center gap-2 text-[12px] font-medium">
                              <span className="text-[13px]">{g.icon}</span>
                              {g.label}
                            </span>
                            {count > 0 && <span className={"text-[10px] px-1.5 py-0.5 rounded-md font-medium " + (isActive && g.accent ? "bg-violet-200 text-violet-700" : isActive ? "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-secondary)]" : "bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)]")}>{count}</span>}
                          </button>
                        );
                      })}
                    </div>
                    {/* Synthesize button in nav */}
                    <div className="p-3 border-t border-[var(--hm-border)]">
                      <button onClick={synthesizeSkills} disabled={synthesizing} className="w-full h-8 bg-gradient-to-r from-violet-500 to-indigo-600 text-white rounded-lg text-[11px] font-medium flex items-center justify-center gap-1.5 hover:opacity-90 disabled:opacity-60">
                        {synthesizing
                          ? <><span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />Synthesizing...</>
                          : <><svg width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M13.5 8a5.5 5.5 0 1 1-1.1-3.3" stroke="white" strokeWidth="1.5" strokeLinecap="round"/><path d="M13.5 2.5v3.5H10" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Refresh learned</>
                        }
                      </button>
                    </div>
                  </div>

                  {/* Col 2 — Skill list */}
                  <div className="w-[240px] flex-shrink-0 border-r border-[var(--hm-border)] flex flex-col">
                    <div className="p-3 border-b border-[var(--hm-border)] flex items-center justify-between">
                      <p className="text-[11px] font-semibold text-[var(--hm-text-secondary)]">{NAV_GROUPS.find(g => g.key === activeGroup)?.label}</p>
                      {activeGroup !== "synthesized" && skills.filter(s => s.category === activeGroup && s.isActive).length > 0 && (
                        <span className="text-[9px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded-md">{skills.filter(s => s.category === activeGroup && s.isActive).length} active</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                      {visibleSkills.length === 0 ? (
                        <div className="p-4 text-center">
                          <p className="text-[11px] text-[var(--hm-text-tertiary)]">
                            {activeGroup === "synthesized" ? "No learned skills yet — click Refresh learned to synthesize from your learning log." : "No skills yet."}
                          </p>
                          {activeGroup !== "synthesized" && !seeded && (
                            <button onClick={seedDefaults} className="mt-2 text-[11px] text-[#4361ee] hover:underline">Load defaults</button>
                          )}
                        </div>
                      ) : visibleSkills.map(s => {
                        const isSelected = editingSkill?.id === s.id;
                        const isSynth = s.linkedFeature === "synthesized";
                        return (
                          <button
                            key={s.id}
                            onClick={() => { setEditingSkill(s); setShowAddSkill(false); }}
                            className={"w-full text-left p-3 rounded-lg border transition-all " + (isSelected ? (isSynth ? "border-violet-300 bg-violet-50" : "border-[#4361ee] bg-blue-50") : "border-transparent hover:border-[var(--hm-border)] hover:bg-[var(--hm-bg-secondary)]")}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <p className={"text-[12px] font-medium truncate " + (isSelected ? (isSynth ? "text-violet-700" : "text-[#4361ee]") : "text-[var(--hm-text-primary)]")}>{s.name}</p>
                              <div className={"w-1.5 h-1.5 rounded-full flex-shrink-0 ml-1 " + (s.isActive ? (isSynth ? "bg-violet-500" : "bg-emerald-500") : "bg-gray-300")} />
                            </div>
                            <p className="text-[10px] text-[var(--hm-text-tertiary)] leading-[1.5] line-clamp-2">{s.instructions.slice(0, 75)}{s.instructions.length > 75 ? "…" : ""}</p>
                          </button>
                        );
                      })}
                    </div>
                    {activeGroup !== "synthesized" && (
                      <div className="p-2 border-t border-[var(--hm-border)]">
                        <button onClick={() => { setShowAddSkill(true); setEditingSkill(null); }} className="w-full h-8 border border-dashed border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-tertiary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-all">+ New skill</button>
                      </div>
                    )}
                  </div>

                  {/* Col 3 — Detail / editor */}
                  <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {!editingSkill && !showAddSkill ? (
                      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
                        <div className="w-12 h-12 rounded-xl bg-[var(--hm-bg-secondary)] flex items-center justify-center mb-3">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 4.8L20 8l-4 3.9 1 5.6L12 15l-5 2.5 1-5.6L4 8l5.6-.8z" stroke="#9ca3af" strokeWidth="1.5" strokeLinejoin="round"/></svg>
                        </div>
                        <p className="text-[13px] font-medium text-[var(--hm-text-secondary)] mb-1">Select a skill to view or edit</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)]">Or click + New skill to create one</p>
                      </div>
                    ) : showAddSkill ? (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        <div className="flex items-center justify-between p-5 pb-4 flex-shrink-0">
                          <p className="text-[13px] font-semibold">New skill</p>
                          <button onClick={() => setShowAddSkill(false)} className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee]">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto px-5 space-y-3">
                          <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1 font-medium">Name *</label><input type="text" value={newSkill.name} onChange={e => setNewSkill({ ...newSkill, name: e.target.value })} className="w-full text-[13px]" placeholder="e.g. Email subject lines" /></div>
                          <div className="grid grid-cols-2 gap-3">
                            <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1 font-medium">Category</label><select value={newSkill.category} onChange={e => setNewSkill({ ...newSkill, category: e.target.value })} className="w-full text-[13px]"><option value="writing">Writing</option><option value="brand_design">Brand & Design</option><option value="ai_behavior">AI Behavior</option><option value="seo">SEO</option></select></div>
                            <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1 font-medium">Feature</label><select value={newSkill.linkedFeature} onChange={e => setNewSkill({ ...newSkill, linkedFeature: e.target.value })} className="w-full text-[13px]"><option value="content_generator">Content Generator</option><option value="brand_scoring">Brand Scoring</option><option value="ai_assistant">AI Assistant</option><option value="all">All features</option></select></div>
                          </div>
                          <div><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1 font-medium">Description</label><input type="text" value={newSkill.description} onChange={e => setNewSkill({ ...newSkill, description: e.target.value })} className="w-full text-[13px]" placeholder="One-line summary" /></div>
                          <div className="flex-1"><label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1 font-medium">Instructions *</label><textarea value={newSkill.instructions} onChange={e => setNewSkill({ ...newSkill, instructions: e.target.value })} className="w-full text-[13px] min-h-[180px]" placeholder="Describe exactly how the AI should behave for this skill..." /></div>
                        </div>
                        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--hm-border)] flex-shrink-0">
                          <button onClick={() => setShowAddSkill(false)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
                          <button onClick={addSkill} disabled={saving || !newSkill.name || !newSkill.instructions} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">Add skill</button>
                        </div>
                      </div>
                    ) : editingSkill ? (
                      editingSkill.linkedFeature === "synthesized" ? (
                        <div className="flex-1 flex flex-col overflow-hidden">
                          <div className="flex items-start justify-between gap-3 p-5 pb-4 flex-shrink-0">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-[9px] px-2 py-0.5 bg-violet-50 text-violet-600 border border-violet-100 rounded-full font-medium">Auto-synthesized</span>
                                <span className="text-[9px] text-[var(--hm-text-tertiary)]">{fl(editingSkill.linkedFeature)}</span>
                              </div>
                              <p className="text-[15px] font-semibold">{editingSkill.name}</p>
                              {editingSkill.description && (
                                <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{editingSkill.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <button
                                role="switch"
                                aria-checked={editingSkill.isActive}
                                aria-label={editingSkill.isActive ? "Disable skill" : "Enable skill"}
                                onClick={e => { e.stopPropagation(); toggleSkill(editingSkill); setEditingSkill({ ...editingSkill, isActive: !editingSkill.isActive }); }}
                                className={"w-9 h-5 rounded-full transition-all flex items-center " + (editingSkill.isActive ? "bg-violet-500" : "bg-gray-200")}
                              >
                                <div aria-hidden="true" className={"w-4 h-4 bg-white rounded-full shadow-sm transition-transform " + (editingSkill.isActive ? "translate-x-4" : "translate-x-0.5")} />
                              </button>
                            </div>
                          </div>
                          <div className="border-t border-[var(--hm-border)] flex-shrink-0" />
                          <div className="flex-1 overflow-y-auto px-5 py-4">
                            <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-2">Auto-synthesized from learnings — read only</p>
                            <p className="text-[13px] leading-[1.65] text-[var(--hm-text-secondary)]">{editingSkill.instructions}</p>
                          </div>
                          <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--hm-border)] flex-shrink-0">
                            <button
                              onClick={() => downloadOneMd(editingSkill)}
                              className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] flex items-center gap-1.5 hover:border-[#4361ee] hover:text-[#4361ee] transition-all"
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                              Download .md
                            </button>
                            <button onClick={() => setEditingSkill(null)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Close</button>
                          </div>
                        </div>
                      ) : (
                      <div className="flex-1 flex flex-col overflow-hidden">
                        {/* Skill header */}
                        <div className="flex items-start justify-between gap-3 p-5 pb-4 flex-shrink-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[9px] text-[var(--hm-text-tertiary)]">{fl(editingSkill.linkedFeature)}</span>
                            </div>
                            <input
                              type="text"
                              value={editingSkill.name}
                              onChange={e => setEditingSkill({ ...editingSkill, name: e.target.value })}
                              className="w-full text-[15px] font-semibold bg-transparent border-none outline-none p-0 focus:ring-0"
                            />
                            {editingSkill.description && (
                              <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">{editingSkill.description}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <button
                              role="switch"
                              aria-checked={editingSkill.isActive}
                              aria-label={editingSkill.isActive ? "Disable skill" : "Enable skill"}
                              onClick={e => { e.stopPropagation(); toggleSkill(editingSkill); setEditingSkill({ ...editingSkill, isActive: !editingSkill.isActive }); }}
                              className={"w-9 h-5 rounded-full transition-all flex items-center " + (editingSkill.isActive ? "bg-emerald-500" : "bg-gray-200")}
                            >
                              <div aria-hidden="true" className={"w-4 h-4 bg-white rounded-full shadow-sm transition-transform " + (editingSkill.isActive ? "translate-x-4" : "translate-x-0.5")} />
                            </button>
                          </div>
                        </div>

                        <div className="border-t border-[var(--hm-border)] flex-shrink-0" />

                        {/* Instructions editor */}
                        <div className="flex-1 overflow-y-auto px-5 py-4">
                          <label className="block text-[11px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Instructions</label>
                          <textarea
                            value={editingSkill.instructions}
                            onChange={e => setEditingSkill({ ...editingSkill, instructions: e.target.value })}
                            className="w-full text-[13px] leading-[1.7] resize-none border border-[var(--hm-border)] rounded-lg p-3 bg-[var(--hm-bg-secondary)] focus:bg-white focus:border-[#4361ee] transition-all min-h-[260px]"
                          />
                        </div>

                        {/* Actions */}
                        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--hm-border)] flex-shrink-0">
                          <div className="flex items-center gap-2">
                            <button onClick={() => confirmAndDelSkill(editingSkill.id, editingSkill.name)} className="h-8 px-3 text-red-500 text-[12px] hover:bg-red-50 active:bg-red-100 rounded-lg transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-1">Delete</button>
                            <button
                              onClick={() => downloadOneMd(editingSkill)}
                              className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] flex items-center gap-1.5 hover:border-[#4361ee] hover:text-[#4361ee] transition-all"
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/><path d="M2 13h12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/></svg>
                              Download .md
                            </button>
                          </div>
                          <div className="flex gap-2">
                            <button onClick={() => setEditingSkill(null)} className="h-8 px-3 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
                            <button onClick={updateSkill} disabled={saving} className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 active:scale-95 transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-2">{saving ? "Saving…" : "Save"}</button>
                          </div>
                        </div>
                      </div>
                      )
                    ) : null}
                  </div>

                </div>
              </div>
            );
          })()}

          {/* ── Brand Style Guide ── */}
          {tab === "brand_style" && (
            <div className="animate-fade-in max-w-[760px]">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h3 className="text-[15px] font-medium">Brand style guide</h3>
                  <p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Define colors, typography, and logo variants — used automatically in every design brief</p>
                </div>
                <button
                  onClick={() => saveStyleGuide(styleGuide)}
                  disabled={styleSaving}
                  className="h-8 px-4 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1.5 flex-shrink-0"
                >
                  {styleSaving ? <><span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : styleSaved ? <>✓ Saved</> : <>Save style guide</>}
                </button>
              </div>

              {!styleLoaded ? (
                <div className="flex items-center gap-2 py-12 justify-center text-[12px] text-[var(--hm-text-tertiary)]">
                  <span className="w-4 h-4 border-2 border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />Loading…
                </div>
              ) : (
                <div className="space-y-6">

                  {/* ── Color palette ── */}
                  <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-[13px] font-medium">Color palette</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Exact hex values will be passed to design briefs</p>
                      </div>
                      {styleGuide.colors.length < 10 && (
                        <button
                          onClick={() => setStyleGuide(g => ({ ...g, colors: [...g.colors, { name: "New color", hex: "#4361EE", usage: "" }] }))}
                          className="h-7 px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors flex items-center gap-1"
                        >
                          <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
                          Add color
                        </button>
                      )}
                    </div>
                    {styleGuide.colors.length === 0 ? (
                      <div className="border-2 border-dashed border-[var(--hm-border)] rounded-lg p-6 text-center">
                        <p className="text-[12px] text-[var(--hm-text-tertiary)]">No colors defined yet — click "Add color" to start</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {styleGuide.colors.map((color, i) => (
                          <div key={i} className="flex items-center gap-3 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg">
                            {/* Swatch + hex picker */}
                            <div className="relative flex-shrink-0">
                              <div className="w-8 h-8 rounded-md border border-[var(--hm-border)] cursor-pointer overflow-hidden" style={{ backgroundColor: color.hex || "#ccc" }}>
                                <input
                                  type="color"
                                  value={color.hex || "#000000"}
                                  onChange={e => {
                                    const next = [...styleGuide.colors];
                                    next[i] = { ...next[i], hex: e.target.value };
                                    setStyleGuide(g => ({ ...g, colors: next }));
                                  }}
                                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                  title="Pick color"
                                />
                              </div>
                            </div>
                            {/* Hex input */}
                            <input
                              type="text"
                              value={color.hex}
                              onChange={e => {
                                const next = [...styleGuide.colors];
                                next[i] = { ...next[i], hex: e.target.value };
                                setStyleGuide(g => ({ ...g, colors: next }));
                              }}
                              placeholder="#000000"
                              className="w-[88px] h-7 px-2 text-[11px] font-mono border border-[var(--hm-border)] rounded-md focus:outline-none focus:border-[#4361ee] bg-white flex-shrink-0"
                            />
                            {/* Name */}
                            <input
                              type="text"
                              value={color.name}
                              onChange={e => {
                                const next = [...styleGuide.colors];
                                next[i] = { ...next[i], name: e.target.value };
                                setStyleGuide(g => ({ ...g, colors: next }));
                              }}
                              placeholder="e.g. Primary"
                              className="w-[110px] h-7 px-2 text-[12px] border border-[var(--hm-border)] rounded-md focus:outline-none focus:border-[#4361ee] bg-white flex-shrink-0"
                            />
                            {/* Usage */}
                            <input
                              type="text"
                              value={color.usage}
                              onChange={e => {
                                const next = [...styleGuide.colors];
                                next[i] = { ...next[i], usage: e.target.value };
                                setStyleGuide(g => ({ ...g, colors: next }));
                              }}
                              placeholder="e.g. CTAs, headlines, links"
                              className="flex-1 h-7 px-2 text-[12px] border border-[var(--hm-border)] rounded-md focus:outline-none focus:border-[#4361ee] bg-white min-w-0"
                            />
                            <button
                              onClick={() => setStyleGuide(g => ({ ...g, colors: g.colors.filter((_, j) => j !== i) }))}
                              className="w-6 h-6 flex items-center justify-center text-[var(--hm-text-tertiary)] hover:text-red-500 transition-colors flex-shrink-0"
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── Typography ── */}
                  <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    <div className="mb-4">
                      <p className="text-[13px] font-medium">Typography</p>
                      <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Font families passed as-is to design briefs — use exact names (e.g. "Inter", "Söhne", "GT Walsheim")</p>
                    </div>
                    <div className="space-y-3">
                      {(["heading", "body", "accent"] as const).map(level => (
                        <div key={level} className="flex items-center gap-3">
                          <span className="text-[11px] text-[var(--hm-text-tertiary)] capitalize w-16 flex-shrink-0">{level}</span>
                          <input
                            type="text"
                            value={styleGuide.typography[level].family}
                            onChange={e => setStyleGuide(g => ({ ...g, typography: { ...g.typography, [level]: { ...g.typography[level], family: e.target.value } } }))}
                            placeholder="Font family (e.g. Inter)"
                            className="flex-1 h-8 px-3 text-[12px] border border-[var(--hm-border)] rounded-lg focus:outline-none focus:border-[#4361ee] bg-[var(--hm-bg-secondary)]"
                          />
                          <input
                            type="text"
                            value={styleGuide.typography[level].weight}
                            onChange={e => setStyleGuide(g => ({ ...g, typography: { ...g.typography, [level]: { ...g.typography[level], weight: e.target.value } } }))}
                            placeholder="Weight"
                            className="w-20 h-8 px-3 text-[12px] border border-[var(--hm-border)] rounded-lg focus:outline-none focus:border-[#4361ee] bg-[var(--hm-bg-secondary)] flex-shrink-0"
                          />
                          <input
                            type="text"
                            value={styleGuide.typography[level].notes}
                            onChange={e => setStyleGuide(g => ({ ...g, typography: { ...g.typography, [level]: { ...g.typography[level], notes: e.target.value } } }))}
                            placeholder="Notes (e.g. size, tracking)"
                            className="flex-[2] h-8 px-3 text-[12px] border border-[var(--hm-border)] rounded-lg focus:outline-none focus:border-[#4361ee] bg-[var(--hm-bg-secondary)]"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* ── Logo variants ── */}
                  <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <p className="text-[13px] font-medium">Logo variants</p>
                        <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-0.5">Upload PNG, SVG, or JPG — URLs are embedded in design briefs for direct use</p>
                      </div>
                      <label className={"h-7 px-3 border border-[var(--hm-border)] rounded-lg text-[11px] text-[var(--hm-text-secondary)] hover:border-[#4361ee] hover:text-[#4361ee] transition-colors flex items-center gap-1 cursor-pointer " + (logoUploading ? "opacity-50 pointer-events-none" : "")}>
                        {logoUploading ? <><span className="w-3 h-3 border-[1.5px] border-[#4361ee]/30 border-t-[#4361ee] rounded-full animate-spin" />Uploading…</> : <><svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M8 2v8M5 7l3-3 3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 13h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>Upload logo</>}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                          className="hidden"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setLogoUploading(true);
                            const url = await uploadLogo(file);
                            if (url) {
                              const variantName = file.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ");
                              setStyleGuide(g => ({ ...g, logoVariants: [...g.logoVariants, { name: variantName, url, usage: "" }] }));
                            }
                            setLogoUploading(false);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </div>
                    {styleGuide.logoVariants.length === 0 ? (
                      <div className="border-2 border-dashed border-[var(--hm-border)] rounded-lg p-6 text-center">
                        <p className="text-[12px] text-[var(--hm-text-tertiary)]">No logos uploaded — upload light, dark, and icon variants for complete coverage</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {styleGuide.logoVariants.map((logo, i) => (
                          <div key={i} className="flex items-center gap-3 p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg">
                            {/* Preview */}
                            <div className="w-10 h-10 rounded-lg border border-[var(--hm-border)] bg-white flex items-center justify-center flex-shrink-0 overflow-hidden p-1">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={logo.url} alt={logo.name} className="max-w-full max-h-full object-contain" />
                            </div>
                            {/* Name */}
                            <input
                              type="text"
                              value={logo.name}
                              onChange={e => {
                                const next = [...styleGuide.logoVariants];
                                next[i] = { ...next[i], name: e.target.value };
                                setStyleGuide(g => ({ ...g, logoVariants: next }));
                              }}
                              placeholder="e.g. Full logo (light)"
                              className="w-[170px] h-7 px-2 text-[12px] border border-[var(--hm-border)] rounded-md focus:outline-none focus:border-[#4361ee] bg-white flex-shrink-0"
                            />
                            {/* Usage */}
                            <input
                              type="text"
                              value={logo.usage}
                              onChange={e => {
                                const next = [...styleGuide.logoVariants];
                                next[i] = { ...next[i], usage: e.target.value };
                                setStyleGuide(g => ({ ...g, logoVariants: next }));
                              }}
                              placeholder="e.g. Use on dark or coloured backgrounds"
                              className="flex-1 h-7 px-2 text-[12px] border border-[var(--hm-border)] rounded-md focus:outline-none focus:border-[#4361ee] bg-white min-w-0"
                            />
                            <a href={logo.url} target="_blank" rel="noopener noreferrer" className="text-[10px] text-[#4361ee] hover:underline flex-shrink-0 whitespace-nowrap">View ↗</a>
                            <button
                              onClick={() => setStyleGuide(g => ({ ...g, logoVariants: g.logoVariants.filter((_, j) => j !== i) }))}
                              className="w-6 h-6 flex items-center justify-center text-[var(--hm-text-tertiary)] hover:text-red-500 transition-colors flex-shrink-0"
                            >
                              <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* ── Design rules ── */}
                  <div className="bg-white border border-[var(--hm-border)] rounded-xl p-5" style={{ boxShadow: "var(--hm-shadow-card)" }}>
                    <p className="text-[13px] font-medium mb-1">Design rules</p>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-4">Specific do's and don'ts passed verbatim to every design brief</p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-[11px] font-medium text-emerald-700 mb-1.5">✓ Always do</label>
                        <textarea
                          value={styleGuide.guidelines}
                          onChange={e => setStyleGuide(g => ({ ...g, guidelines: e.target.value }))}
                          placeholder={"e.g.\n- Maintain clear space equal to the logo height\n- Use Inter for all digital touchpoints\n- Keep primary blue dominant at 60%"}
                          rows={5}
                          className="w-full px-3 py-2.5 text-[12px] border border-[var(--hm-border)] rounded-lg focus:outline-none focus:border-[#4361ee] resize-none bg-[var(--hm-bg-secondary)] leading-relaxed"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-red-600 mb-1.5">✗ Never do</label>
                        <textarea
                          value={styleGuide.doNotUse}
                          onChange={e => setStyleGuide(g => ({ ...g, doNotUse: e.target.value }))}
                          placeholder={"e.g.\n- Do not stretch or recolour the logo\n- Do not use gradients on text\n- Do not use more than 3 typefaces"}
                          rows={5}
                          className="w-full px-3 py-2.5 text-[12px] border border-[var(--hm-border)] rounded-lg focus:outline-none focus:border-[#4361ee] resize-none bg-[var(--hm-bg-secondary)] leading-relaxed"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Save button (bottom) */}
                  <div className="flex justify-end pb-2">
                    <button
                      onClick={() => saveStyleGuide(styleGuide)}
                      disabled={styleSaving}
                      className="h-9 px-6 bg-[#4361ee] text-white rounded-lg text-[12px] font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
                    >
                      {styleSaving ? <><span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />Saving…</> : styleSaved ? <>✓ Saved</> : <>Save style guide</>}
                    </button>
                  </div>

                </div>
              )}
            </div>
          )}

          {/* Learning Log */}
          {tab === "learning" && (
            <div className="animate-fade-in max-w-[720px]">
              <div className="flex items-center justify-between mb-1">
                <div><h3 className="text-[15px] font-medium">Learning log</h3><p className="text-[12px] text-[var(--hm-text-tertiary)] mt-0.5">Everything HiveMind has learned — feeds directly into the AI context engine</p></div>
                <span className="text-[11px] px-2.5 py-1 bg-[var(--hm-bg-secondary)] border border-[var(--hm-border)] rounded-lg text-[var(--hm-text-tertiary)]">{logs.length} entries</span>
              </div>
              <div className="mb-5" />
              {logs.length === 0 ? (
                <div className="bg-white border border-[var(--hm-border)] rounded-xl p-10 text-center"><p className="text-[14px] font-medium mb-1">No learnings yet</p><p className="text-[12px] text-[var(--hm-text-tertiary)]">Upload documents or refresh industry insights to populate the learning log</p></div>
              ) : logs.map((log, i) => {
                const sourceColors: Record<string, string> = { website_update: "bg-blue-50 text-blue-600", competitor_update: "bg-red-50 text-red-600", industry_report: "bg-amber-50 text-amber-600", regulatory: "bg-emerald-50 text-emerald-600", document_upload: "bg-violet-50 text-violet-600", industry_insight: "bg-teal-50 text-teal-600", content_analysis: "bg-sky-50 text-sky-600", proof_point: "bg-lime-50 text-lime-600", messaging_pattern: "bg-pink-50 text-pink-600" };
                const kbColors: Record<string, string> = { brand: "bg-pink-50 text-pink-600", product: "bg-blue-50 text-blue-600", market: "bg-teal-50 text-teal-600", persona: "bg-orange-50 text-orange-600", competitor: "bg-red-50 text-red-600", messaging: "bg-purple-50 text-purple-600", proof_point: "bg-lime-50 text-lime-600", general: "bg-gray-50 text-gray-600" };
                const kbLabels: Record<string, string> = { brand: "Brand voice", product: "Product knowledge", market: "Market signal", persona: "Persona insight", competitor: "Competitive intel", messaging: "Messaging pattern", proof_point: "Proof point", general: "General" };
                const isDocUpload = log.sourceType === "document_upload";
                const isInsight = log.sourceType === "industry_insight";
                const kbCat = isDocUpload ? (log.kbCategories?.[0] || "general") : null;
                const badgeColor = kbCat ? (kbColors[kbCat] || "bg-gray-50 text-gray-600") : (sourceColors[log.sourceType] || "bg-gray-50 text-gray-600");
                const c = sourceColors[log.sourceType] || "bg-gray-50 text-gray-600";
                return (
                  <div key={i} className="flex gap-3 mb-3">
                    <div className="flex flex-col items-center">
                      <div className={"w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 " + badgeColor.split(" ")[0]}>
                        {isDocUpload ? (
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/><path d="M10 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        ) : isInsight ? (
                          <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM8 5v4M8 11h.01" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-current" />
                        )}
                      </div>
                      {i < logs.length - 1 && <div className="w-px flex-1 bg-[var(--hm-border)] mt-1" />}
                    </div>
                    <div className={"flex-1 bg-white border rounded-xl p-4 mb-1 " + (isDocUpload ? "border-violet-100" : "border-[var(--hm-border)]")}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={"text-[10px] px-2 py-0.5 rounded-md font-medium " + badgeColor}>
                            {kbCat ? (kbLabels[kbCat] || kbCat.replace(/_/g, " ")) : isInsight ? "Market signal" : log.sourceType.replace(/_/g, " ")}
                          </span>
                          {isDocUpload && log.sourceDocumentName && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-violet-50 text-violet-500 border border-violet-100 flex items-center gap-1">
                              <svg width="8" height="8" viewBox="0 0 16 16" fill="none"><path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                              {log.sourceDocumentFile?.split(".").pop()?.toUpperCase()} · {log.sourceDocumentName}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-[var(--hm-text-tertiary)] whitespace-nowrap flex-shrink-0">{new Date(log.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </div>
                      <p className="text-[12px] font-medium mb-1.5">{log.title}</p>
                      <p className="text-[12px] text-[var(--hm-text-secondary)] leading-[1.6]">{log.summary}</p>
                      {log.takeaway && (
                        <div className="mt-2.5 p-2.5 bg-amber-50 border border-amber-100 rounded-lg flex items-start gap-2">
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5"><path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="#F59E0B" strokeWidth="1"/><path d="M8 5v3M8 10h.01" stroke="#F59E0B" strokeWidth="1.2" strokeLinecap="round"/></svg>
                          <p className="text-[11px] text-amber-700 leading-[1.5]"><span className="font-medium">AI implication: </span>{log.takeaway}</p>
                        </div>
                      )}
                      {log.tags?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2.5">
                          {log.tags.map((tag, ti) => <span key={ti} className="text-[9px] px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] text-[var(--hm-text-tertiary)] rounded-md">{tag}</span>)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      {/* Delete confirmation modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm animate-fade-in"
          onKeyDown={(e) => { if (e.key === "Escape") setConfirmDelete(null); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-delete-title"
            className="bg-white rounded-xl shadow-xl border border-[var(--hm-border)] p-6 max-w-[340px] w-full mx-4"
          >
            <p id="confirm-delete-title" className="text-[14px] font-semibold mb-1">Delete &ldquo;{confirmDelete.label}&rdquo;?</p>
            <p className="text-[12px] text-[var(--hm-text-tertiary)] mb-5">This cannot be undone.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDelete(null)} className="h-8 px-4 border border-[var(--hm-border)] rounded-lg text-[12px] hover:bg-[var(--hm-bg-secondary)] hover:border-[#4361ee]/40 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4361ee] focus-visible:ring-offset-1">Cancel</button>
              <button
                onClick={async () => {
                  const { section, id } = confirmDelete;
                  setConfirmDelete(null);
                  if (section === "__skill__") { await delSkill(id); }
                  else if (section === "market_delete") { await fetch("/api/knowledge/edit", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ section: "market_delete", id }) }); setEditMarket(null); fetchAll(); }
                  else { await deleteItem(section, id); }
                }}
                className="h-8 px-4 bg-red-500 text-white rounded-lg text-[12px] font-medium hover:bg-red-600 active:bg-red-700 active:scale-95 transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2"
              >Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
