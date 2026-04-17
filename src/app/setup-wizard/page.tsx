"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Step data types
interface CompanyData {
  description: string;
  industry: string;
  subIndustry: string;
  size: string;
  hqCity: string;
  hqCountry: string;
  yearFounded: string;
  mission: string;
  vision: string;
}

interface MarketData {
  name: string;
  type: "primary" | "expansion";
}

interface ProductData {
  name: string;
  description: string;
  category: string;
  classification: string;
  scope: string;
  features: string[];
  useCases: string;
  markets: string[];
}

interface PersonaData {
  title: string;
  department: string;
  seniority: string;
  kras: string[];
  kpis: string[];
  painPoints: string;
  howWeHelp: string;
  contentPrefs: string[];
}

interface CompetitorData {
  name: string;
  website: string;
  marketOverlap: string[];
  positioning: string;
  differentiator: string;
}

interface BrandData {
  traits: string[];
  archetype: string;
  toneFormal: number;
  toneTechnical: number;
  toneSerious: number;
  toneCorporate: number;
  voiceDescription: string;
  wordsWeUse: string[];
  wordsWeAvoid: string[];
  competitiveMoat: string;
}

interface OrgInfo {
  name: string;
  website: string;
}

const INDUSTRIES = [
  "SaaS / Software", "E-Commerce", "FinTech", "Healthcare", "EdTech",
  "Logistics & Supply Chain", "Retail", "Media & Publishing",
  "Manufacturing", "Real Estate", "Travel & Hospitality",
  "Consulting & Services", "Other",
];

const COMPANY_SIZES = ["1–10", "11–50", "51–200", "201–500", "500+"];

const COUNTRIES = [
  "India", "United States", "United Kingdom", "UAE",
  "Singapore", "Germany", "Other",
];

const DEPARTMENTS = [
  "Operations", "Supply Chain", "Product", "Engineering",
  "Marketing", "Sales", "Growth", "Design", "Other",
];

const SENIORITY_LEVELS = ["C-Suite / VP", "Director", "Head of", "Manager", "IC"];

const CONTENT_PREFS = [
  "ROI Reports", "Case Studies", "Short-form", "Video",
  "Whitepapers", "Webinars", "Blogs", "Infographics",
];

const PERSONALITY_TRAITS = [
  "Authoritative", "Technical", "Playful", "Trustworthy", "Warm",
  "Innovative", "Bold", "Minimalist", "Data-driven", "Empathetic",
  "Premium", "Approachable",
];

const ARCHETYPES = [
  { name: "The Sage", desc: "Wisdom, expertise, truth-seeking" },
  { name: "The Expert", desc: "Mastery, authority, precision" },
  { name: "The Creator", desc: "Innovation, vision, originality" },
  { name: "The Hero", desc: "Courage, achievement, mastery" },
  { name: "The Caregiver", desc: "Service, generosity, protection" },
  { name: "The Rebel", desc: "Disruption, liberation, revolution" },
  { name: "The Explorer", desc: "Freedom, discovery, ambition" },
  { name: "The Ruler", desc: "Control, leadership, stability" },
  { name: "The Magician", desc: "Transformation, vision, moments" },
  { name: "The Jester", desc: "Humor, joy, irreverence" },
  { name: "The Everyman", desc: "Belonging, relatability, trust" },
  { name: "The Lover", desc: "Passion, intimacy, commitment" },
];

export default function SetupWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = useState(0); // 0-indexed: 0=company, 1=markets, 2=customers, 3=competition, 4=brand, 5=review
  const [orgInfo, setOrgInfo] = useState<OrgInfo>({ name: "", website: "" });
  const [saving, setSaving] = useState(false);
  const [wizardComplete, setWizardComplete] = useState(false);
  const [stepErrors, setStepErrors] = useState<string[]>([]);
  const [activated, setActivated] = useState(false);

  // Step data
  const [company, setCompany] = useState<CompanyData>({
    description: "", industry: "", subIndustry: "", size: "",
    hqCity: "", hqCountry: "", yearFounded: "", mission: "", vision: "",
  });
  const [markets, setMarkets] = useState<MarketData[]>([]);
  const [marketInput, setMarketInput] = useState("");
  const [expansionInput, setExpansionInput] = useState("");
  const [marketNotes, setMarketNotes] = useState("");
  const [products, setProducts] = useState<ProductData[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<number | null>(null);
  const [personas, setPersonas] = useState<PersonaData[]>([]);
  const [expandedPersona, setExpandedPersona] = useState<number | null>(null);
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  const [expandedCompetitor, setExpandedCompetitor] = useState<number | null>(null);
  const [competitiveMoat, setCompetitiveMoat] = useState("");
  const [brand, setBrand] = useState<BrandData>({
    traits: [], archetype: "", toneFormal: 30, toneTechnical: 25,
    toneSerious: 35, toneCorporate: 45, voiceDescription: "",
    wordsWeUse: [], wordsWeAvoid: [], competitiveMoat: "",
  });
  const [icpDescription, setIcpDescription] = useState("");
  const [showMoreArchetypes, setShowMoreArchetypes] = useState(false);
  const [showOptional, setShowOptional] = useState(false);
  const [aiPopulating, setAiPopulating] = useState(false);
  const [aiPopulateError, setAiPopulateError] = useState("");
  const [featureInput, setFeatureInput] = useState("");
  const [kraInput, setKraInput] = useState("");
  const [kpiInput, setKpiInput] = useState("");
  const [useWordInput, setUseWordInput] = useState("");
  const [avoidWordInput, setAvoidWordInput] = useState("");
  const [dataLoaded, setDataLoaded] = useState(false);
  const steps = [
    { label: "Company info", sub: "Description & industry" },
    { label: "Markets & products", sub: "Geographies & offerings" },
    { label: "Customers & personas", sub: "ICP & buyer profiles" },
    { label: "Competition", sub: "Landscape & moat" },
    { label: "Brand identity", sub: "Voice, tone & archetype" },
    { label: "Review & launch", sub: "Confirm & activate" },
  ];

  useEffect(() => {
    // Check for ?step= param
    const params = new URLSearchParams(window.location.search);
    const stepParam = params.get("step");
    if (stepParam) setCurrentStep(parseInt(stepParam));

    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) {
        setOrgInfo({ name: d.user.organization?.name || "", website: d.user.organization?.website || "" });
      } else {
        router.push("/login");
      }
    });

    // Load existing data
    fetch("/api/setup-wizard/load").then((r) => r.json()).then((d) => {
      if (d.org) {
        setCompany({
          description: d.org.description || "",
          industry: d.org.industry || "",
          subIndustry: d.org.subIndustry || "",
          size: d.org.size || "",
          hqCity: d.org.hqCity || "",
          hqCountry: d.org.hqCountry || "",
          yearFounded: d.org.yearFounded ? String(d.org.yearFounded) : "",
          mission: d.org.mission || "",
          vision: d.org.vision || "",
        });
      }
      if (d.markets?.length > 0) {
        setMarkets(d.markets.map((m: { name: string; type: string }) => ({ name: m.name, type: m.type })));
      }
      if (d.products?.length > 0) {
        setProducts(d.products.map((p: { name: string; description: string; category: string; classification: string; scope: string; features: string[]; useCases: string; markets: string[] }) => ({
          name: p.name, description: p.description, category: p.category,
          classification: p.classification, scope: p.scope,
          features: p.features || [], useCases: p.useCases || "", markets: p.markets || [],
        })));
      }
      if (d.personas?.length > 0) {
        setPersonas(d.personas.map((p: { title: string; department: string; seniority: string; painPoints: string; howWeHelp: string; kras: string[]; kpis: string[]; contentPrefs: string[] }) => ({
          title: p.title, department: p.department, seniority: p.seniority,
          painPoints: p.painPoints, howWeHelp: p.howWeHelp,
          kras: p.kras || [], kpis: p.kpis || [], contentPrefs: p.contentPrefs || [],
        })));
      }
      if (d.competitors?.length > 0) {
        setCompetitors(d.competitors.map((c: { name: string; website: string; positioning: string; differentiator: string; marketOverlap: string[] }) => ({
          name: c.name, website: c.website, positioning: c.positioning,
          differentiator: c.differentiator, marketOverlap: c.marketOverlap || [],
        })));
      }
      if (d.brandProfile) {
        setBrand({
          traits: d.brandProfile.traits || [],
          archetype: d.brandProfile.archetype || "",
          toneFormal: d.brandProfile.toneFormal ?? 50,
          toneTechnical: d.brandProfile.toneTechnical ?? 50,
          toneSerious: d.brandProfile.toneSerious ?? 50,
          toneCorporate: d.brandProfile.toneCorporate ?? 50,
          voiceDescription: d.brandProfile.voiceDescription || "",
          wordsWeUse: d.brandProfile.wordsWeUse || [],
          wordsWeAvoid: d.brandProfile.wordsWeAvoid || [],
          competitiveMoat: d.brandProfile.competitiveMoat || "",
        });
        if (d.brandProfile.competitiveMoat) setCompetitiveMoat(d.brandProfile.competitiveMoat);
      }
      if (d.isComplete) setWizardComplete(true);
      setDataLoaded(true);
    }).catch(() => setDataLoaded(true));
  }, [router]);

  const saveData = async (isComplete = false): Promise<{ ok: boolean; error?: string }> => {
    setSaving(true);
    try {
      const res = await fetch("/api/setup-wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company,
          markets,
          marketNotes,
          products,
          personas,
          competitors,
          competitiveMoat,
          icpDescription,
          brand: { ...brand, competitiveMoat },
          isComplete,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const message = (body as { error?: string })?.error || "Something went wrong. Please try again.";
        return { ok: false, error: message };
      }
      return { ok: true };
    } catch (error) {
      console.error("Setup wizard error:", error);
      return { ok: false, error: "Network error. Please check your connection." };
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAndContinue = async () => {
    const errors = validateStep(currentStep);
    if (errors.length > 0) {
      setStepErrors(errors);
      window.scrollTo(0, 0);
      return;
    }
    setStepErrors([]);
    if (currentStep < 5) {
      setCurrentStep(currentStep + 1);
      window.scrollTo(0, 0);
    } else {
      const result = await saveData(true);
      if (!result.ok) {
        setStepErrors([result.error || "Failed to save. Please try again."]);
        window.scrollTo(0, 0);
        return;
      }
      setActivated(true);
    }
  };

  const addMarket = (name: string, type: "primary" | "expansion") => {
    if (!name.trim()) return;
    if (markets.find((m) => m.name.toLowerCase() === name.toLowerCase())) return;
    setMarkets([...markets, { name: name.trim(), type }]);
  };

  const removeMarket = (name: string) => {
    setMarkets(markets.filter((m) => m.name !== name));
  };

  const addProduct = () => {
    const newProduct: ProductData = {
      name: "", description: "", category: "core", classification: "",
      scope: "global", features: [], useCases: "", markets: [],
    };
    setProducts([...products, newProduct]);
    setExpandedProduct(products.length);
  };

  const updateProduct = (index: number, field: keyof ProductData, value: unknown) => {
    setProducts(products.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const addPersona = () => {
    const newPersona: PersonaData = {
      title: "", department: "", seniority: "", kras: [], kpis: [],
      painPoints: "", howWeHelp: "", contentPrefs: [],
    };
    setPersonas([...personas, newPersona]);
    setExpandedPersona(personas.length);
  };

  const updatePersona = (index: number, field: keyof PersonaData, value: unknown) => {
    setPersonas(personas.map((p, i) => i === index ? { ...p, [field]: value } : p));
  };

  const addCompetitor = () => {
    const newComp: CompetitorData = {
      name: "", website: "", marketOverlap: [], positioning: "", differentiator: "",
    };
    setCompetitors([...competitors, newComp]);
    setExpandedCompetitor(competitors.length);
  };

  const updateCompetitor = (index: number, field: keyof CompetitorData, value: unknown) => {
    setCompetitors(competitors.map((c, i) => i === index ? { ...c, [field]: value } : c));
  };

  const removeProduct = (index: number) => {
    setProducts(products.filter((_, i) => i !== index));
    if (expandedProduct === index) setExpandedProduct(null);
  };

  const removePersona = (index: number) => {
    setPersonas(personas.filter((_, i) => i !== index));
    if (expandedPersona === index) setExpandedPersona(null);
  };

  const removeCompetitor = (index: number) => {
    setCompetitors(competitors.filter((_, i) => i !== index));
    if (expandedCompetitor === index) setExpandedCompetitor(null);
  };

  const fillWithAI = async () => {
    if (!orgInfo.website) return;
    setAiPopulating(true);
    setAiPopulateError("");
    try {
      const res = await fetch("/api/setup-wizard/auto-populate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: orgInfo.website }),
      });
      const json = await res.json();
      if (!res.ok) { setAiPopulateError(json.error || "AI fill failed"); return; }
      const d = json.data;
      if (d.description) setCompany(prev => ({ ...prev, description: d.description || prev.description, industry: d.industry || prev.industry, subIndustry: d.subIndustry || prev.subIndustry, size: d.size || prev.size, hqCity: d.hqCity || prev.hqCity, hqCountry: d.hqCountry || prev.hqCountry, mission: d.mission || prev.mission }));
      if (d.products?.length) setProducts(d.products.map((p: { name: string; description: string; category: string; classification: string; scope: string; features: string[]; useCases: string }) => ({ name: p.name || "", description: p.description || "", category: p.category || "core", classification: p.classification || "", scope: p.scope || "global", features: p.features || [], useCases: p.useCases || "", markets: [] })));
      if (d.brandTraits?.length || d.voiceDescription) setBrand(prev => ({ ...prev, traits: d.brandTraits?.length ? d.brandTraits.slice(0, 5) : prev.traits, voiceDescription: d.voiceDescription || prev.voiceDescription }));
    } catch { setAiPopulateError("Something went wrong"); }
    finally { setAiPopulating(false); }
  };

  const validateStep = (step: number): string[] => {
    const errors: string[] = [];
    if (step === 0) {
      if (!company.description.trim()) errors.push("Company description is required.");
      if (!company.industry) errors.push("Industry is required.");
      if (!company.size) errors.push("Company size is required.");
    }
    if (step === 1) {
      const primaryMarkets = markets.filter((m) => m.type === "primary");
      if (primaryMarkets.length === 0) errors.push("At least one primary market is required.");
    }
    if (step === 2) {
      if (!icpDescription.trim()) errors.push("Ideal customer profile (ICP) description is required.");
    }
    if (step === 4) {
      if (brand.traits.length === 0) errors.push("Select at least one brand personality trait.");
      if (!brand.archetype) errors.push("Select a brand archetype.");
    }
    return errors;
  };

  const getToneLabel = (value: number, labels: [string, string, string, string, string]) => {
    if (value < 25) return labels[0];
    if (value < 40) return labels[1];
    if (value < 60) return labels[2];
    if (value < 75) return labels[3];
    return labels[4];
  };

  const progress = Math.round(((currentStep + 2) / 7) * 100); // +2 because profile is step 1

  if (!orgInfo.name || !dataLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <div className="w-5 h-5 border-2 border-[var(--hm-accent)]/30 border-t-[var(--hm-accent)] rounded-full animate-spin" />
        <p className="text-xs text-[var(--hm-text-tertiary)]">Loading your workspace…</p>
      </div>
    );
  }

  if (activated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--hm-bg-secondary)]">
        <div className="max-w-[420px] w-full bg-white rounded-2xl border border-[var(--hm-border)] p-10 text-center shadow-sm">
          <div className="w-16 h-16 rounded-full bg-emerald-500 flex items-center justify-center mx-auto mb-5">
            <svg width="28" height="28" viewBox="0 0 16 16" fill="none">
              <path d="M3 8.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="text-[22px] font-medium mb-2">HiveMind is activated!</h2>
          <p className="text-sm text-[var(--hm-text-secondary)] leading-relaxed mb-7">
            Your workspace is set up. HiveMind will keep learning from your website and content uploads.
          </p>
          <button
            onClick={() => router.push("/dashboard")}
            className="w-full h-[44px] bg-[var(--hm-accent)] text-white rounded-lg text-[13px] font-medium hover:opacity-90 transition-all"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <div className="w-[260px] bg-[var(--hm-bg-secondary)] border-r border-[var(--hm-border)] p-7 flex flex-col justify-between flex-shrink-0">
        <div>
          <div className="flex items-center gap-2 mb-10">
            <svg width="24" height="24" viewBox="0 0 32 32">
              <path d="M16 2L28 9v14l-12 7L4 23V9z" fill="none" stroke="#4361ee" strokeWidth="1.5" />
              <circle cx="16" cy="16" r="4" fill="#4361ee" opacity="0.8" />
            </svg>
            <span className="text-[15px] font-medium tracking-wide">HiveMind</span>
          </div>

          <div className="flex flex-col">
            {/* Profile — completed */}
            <div className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M3.5 8.5l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
                <div className="w-px h-7 bg-emerald-500/30" />
              </div>
              <div className="pt-1">
                <p className="text-[13px] font-medium text-emerald-500">Your profile</p>
              </div>
            </div>

            {/* Wizard steps */}
            {steps.map((step, i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      i < currentStep
                        ? "bg-emerald-500 text-white"
                        : i === currentStep
                        ? "bg-[var(--hm-accent)] text-white"
                        : "border-[1.5px] border-[var(--hm-border)] text-[var(--hm-text-tertiary)] bg-white"
                    }`}
                  >
                    {i < currentStep ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M3.5 8.5l3 3 6-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      i + 2
                    )}
                  </div>
                  {i < 5 && (
                    <div
                      className={`w-px h-7 ${
                        i < currentStep ? "bg-emerald-500/30" : i === currentStep ? "bg-[var(--hm-accent)]/30" : "bg-[var(--hm-border)]"
                      }`}
                    />
                  )}
                </div>
                <div className="pt-1">
                  <p
                    className={`text-[13px] font-medium ${
                      i < currentStep
                        ? "text-emerald-500"
                        : i === currentStep
                        ? "text-[var(--hm-accent)]"
                        : "text-[var(--hm-text-tertiary)]"
                    }`}
                  >
                    {step.label}
                  </p>
                  {i === currentStep && step.sub && (
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
          </svg>
          <span className="text-xs text-[var(--hm-text-tertiary)]">Need help? Chat with us</span>
        </div>
      </div>

      {/* Main */}
      <div className="flex-1 flex flex-col">
        {/* Re-entry banner */}
        {wizardComplete && (
          <div className="px-9 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="flex-shrink-0">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="#d97706" strokeWidth="1" />
              <path d="M8 5v3M8 10h.01" stroke="#d97706" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
            <p className="text-xs text-amber-700">You&apos;ve already completed setup. Any changes you save here will update your workspace.</p>
          </div>
        )}

        {/* Top bar */}
        <div className="px-9 py-5 border-b border-[var(--hm-border)] flex items-center justify-between">
          <div>
            <p className="text-xs text-[var(--hm-text-tertiary)] uppercase tracking-wider font-medium">
              Step {currentStep + 2} of 7 &mdash; {steps[currentStep].label}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-[120px] h-1 rounded-full bg-[var(--hm-border)] overflow-hidden">
              <div className="h-full bg-[var(--hm-accent)] rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[11px] text-[var(--hm-text-tertiary)]">{progress}%</span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-9 py-10">
          <div className="max-w-[560px] animate-fade-in" key={currentStep}>

            {/* Validation errors */}
            {stepErrors.length > 0 && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl">
                <p className="text-[13px] font-medium text-red-700 mb-1.5">Please fix the following before continuing:</p>
                <ul className="list-disc list-inside space-y-1">
                  {stepErrors.map((err, i) => (
                    <li key={i} className="text-xs text-red-600">{err}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ═══════ STEP 0: COMPANY INFO ═══════ */}
            {currentStep === 0 && (
              <>
                <div className="flex items-start justify-between gap-4 mb-1.5">
                  <h2 className="text-[22px] font-medium">Tell us about your company</h2>
                  {orgInfo.website && (
                    <button
                      onClick={fillWithAI}
                      disabled={aiPopulating}
                      className="flex-shrink-0 h-9 px-4 bg-gradient-to-r from-[#4361ee] to-[#7c3aed] text-white rounded-lg text-[12px] font-medium flex items-center gap-1.5 hover:opacity-90 disabled:opacity-60 transition-all"
                    >
                      {aiPopulating ? (
                        <><span className="w-3 h-3 border-[1.5px] border-white/30 border-t-white rounded-full animate-spin" />Filling…</>
                      ) : (
                        <><span>✦</span>Fill with AI</>
                      )}
                    </button>
                  )}
                </div>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  This information helps HiveMind build a deep understanding of your business.
                </p>

                {aiPopulateError && (
                  <div className="mb-5 p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-600">{aiPopulateError}</div>
                )}

                {orgInfo.website && (
                  <div className="flex items-start gap-2.5 p-3 bg-blue-50 rounded-lg mb-7">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="flex-shrink-0 mt-0.5">
                      <path d="M8 1a7 7 0 100 14A7 7 0 008 1z" stroke="#4361ee" strokeWidth="1" />
                      <path d="M8 5v3M8 10h.01" stroke="#4361ee" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                    <p className="text-xs text-[var(--hm-accent)] leading-relaxed">
                      Since you provided your website URL, HiveMind will automatically enrich this section with publicly available information.
                    </p>
                  </div>
                )}

                <div className="mb-5">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Company name</label>
                  <input type="text" value={orgInfo.name} disabled className="w-full bg-[var(--hm-bg-secondary)]" />
                </div>

                <div className="mb-5">
                  <div className="flex justify-between mb-1.5">
                    <label className="text-[13px] text-[var(--hm-text-secondary)] font-medium">
                      Company description <span className="text-red-400">*</span>
                    </label>
                    <span className="text-[11px] text-[var(--hm-text-tertiary)]">{company.description.length} / 500</span>
                  </div>
                  <textarea
                    value={company.description}
                    onChange={(e) => setCompany({ ...company, description: e.target.value.slice(0, 500) })}
                    placeholder="Describe what your company does in 2-3 sentences."
                    className="w-full h-[100px] resize-y"
                  />
                </div>

                <div className="mb-5">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                    Industry <span className="text-red-400">*</span>
                  </label>
                  <select
                    value={company.industry}
                    onChange={(e) => setCompany({ ...company, industry: e.target.value })}
                    className="w-full h-[38px] cursor-pointer"
                  >
                    <option value="">Select your industry...</option>
                    {INDUSTRIES.map((ind) => (
                      <option key={ind} value={ind}>{ind}</option>
                    ))}
                  </select>
                </div>

                <div className="mb-5">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                    Sub-industry <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={company.subIndustry}
                    onChange={(e) => setCompany({ ...company, subIndustry: e.target.value })}
                    placeholder="e.g., Logistics Intelligence, Post-Purchase SaaS"
                    className="w-full"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 mb-5">
                  <div>
                    <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Company size <span className="text-red-400">*</span>
                    </label>
                    <select
                      value={company.size}
                      onChange={(e) => setCompany({ ...company, size: e.target.value })}
                      className="w-full h-[38px] cursor-pointer"
                    >
                      <option value="">Select...</option>
                      {COMPANY_SIZES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Year founded <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                    </label>
                    <input
                      type="number"
                      value={company.yearFounded}
                      onChange={(e) => setCompany({ ...company, yearFounded: e.target.value })}
                      placeholder="e.g., 2015"
                      className="w-full"
                    />
                  </div>
                </div>

                <div className="mb-5">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                    Headquarters <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                  </label>
                  <div className="grid grid-cols-[1.5fr_1fr] gap-3">
                    <input
                      type="text"
                      value={company.hqCity}
                      onChange={(e) => setCompany({ ...company, hqCity: e.target.value })}
                      placeholder="City"
                      className="w-full"
                    />
                    <select
                      value={company.hqCountry}
                      onChange={(e) => setCompany({ ...company, hqCountry: e.target.value })}
                      className="w-full h-[38px] cursor-pointer"
                    >
                      <option value="">Country...</option>
                      {COUNTRIES.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Optional: Mission / Vision */}
                <div className="mb-2">
                  <button
                    onClick={() => setShowOptional(!showOptional)}
                    className="flex items-center gap-2 text-[13px] text-[var(--hm-text-secondary)] font-medium py-2"
                  >
                    <svg
                      width="12" height="12" viewBox="0 0 16 16" fill="none"
                      className={`transition-transform ${showOptional ? "rotate-90" : ""}`}
                    >
                      <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Additional details
                    <span className="font-normal text-[var(--hm-text-tertiary)] text-[11px]">(mission, vision)</span>
                  </button>
                  {showOptional && (
                    <div className="pt-3 space-y-4 animate-fade-in-fast">
                      <div>
                        <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Mission statement</label>
                        <textarea
                          value={company.mission}
                          onChange={(e) => setCompany({ ...company, mission: e.target.value })}
                          placeholder="What is your company's mission?"
                          className="w-full h-[70px] resize-y"
                        />
                      </div>
                      <div>
                        <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Vision statement</label>
                        <textarea
                          value={company.vision}
                          onChange={(e) => setCompany({ ...company, vision: e.target.value })}
                          placeholder="Where does your company aspire to be?"
                          className="w-full h-[70px] resize-y"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {/* ═══════ STEP 1: MARKETS & PRODUCTS ═══════ */}
            {currentStep === 1 && (
              <>
                <h2 className="text-[22px] font-medium mb-1.5">Markets & products</h2>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  Start by defining where you operate, then add your products.
                </p>

                {/* Markets section */}
                <div className="p-5 border border-[var(--hm-border)] rounded-xl mb-3">
                  <div className="flex items-center gap-2 mb-4">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="6" stroke="#4361ee" strokeWidth="1.2" />
                      <path d="M2 8h12M8 2c-2 2-2 10 0 12M8 2c2 2 2 10 0 12" stroke="#4361ee" strokeWidth="0.8" opacity="0.6" />
                    </svg>
                    <h3 className="text-[15px] font-medium">Your markets</h3>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Primary markets <span className="text-red-400">*</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--hm-border)] rounded-lg min-h-[36px] items-center">
                      {markets.filter((m) => m.type === "primary").map((m) => (
                        <span key={m.name} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--hm-accent)] rounded-md text-xs text-white">
                          {m.name}
                          <button onClick={() => removeMarket(m.name)} className="opacity-70 hover:opacity-100">×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={marketInput}
                        onChange={(e) => setMarketInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { addMarket(marketInput, "primary"); setMarketInput(""); }
                        }}
                        placeholder="Type and press Enter..."
                        className="flex-1 min-w-[100px] border-none shadow-none text-xs p-1 focus:ring-0"
                        style={{ boxShadow: "none" }}
                      />
                    </div>
                    <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-1">These will be available when configuring product scope</p>
                  </div>

                  <div className="mb-4">
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Expansion markets <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--hm-border)] rounded-lg min-h-[36px] items-center">
                      {markets.filter((m) => m.type === "expansion").map((m) => (
                        <span key={m.name} className="inline-flex items-center gap-1 px-2.5 py-1 bg-[var(--hm-bg-secondary)] rounded-md text-xs text-[var(--hm-text)]">
                          {m.name}
                          <button onClick={() => removeMarket(m.name)} className="opacity-40 hover:opacity-100">×</button>
                        </span>
                      ))}
                      <input
                        type="text"
                        value={expansionInput}
                        onChange={(e) => setExpansionInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") { addMarket(expansionInput, "expansion"); setExpansionInput(""); }
                        }}
                        placeholder="Type and press Enter..."
                        className="flex-1 min-w-[100px] border-none shadow-none text-xs p-1 focus:ring-0"
                        style={{ boxShadow: "none" }}
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Market notes <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                    </label>
                    <textarea
                      value={marketNotes}
                      onChange={(e) => setMarketNotes(e.target.value)}
                      placeholder="Any differences in how you operate across markets?"
                      className="w-full h-[56px] resize-y text-[13px]"
                    />
                  </div>
                </div>

                {/* Connector arrow */}
                <div className="flex justify-center py-1">
                  <svg width="20" height="24" viewBox="0 0 20 24">
                    <path d="M10 0v18M4 14l6 6 6-6" fill="none" stroke="#e5e7eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                {/* Products */}
                <div className="mt-1">
                  <div className="flex items-center justify-between mb-3.5">
                    <div className="flex items-center gap-2">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                        <rect x="2" y="4" width="12" height="10" rx="2" stroke="#4361ee" strokeWidth="1.2" />
                        <path d="M5 4V3a3 3 0 016 0v1" stroke="#4361ee" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                      <h3 className="text-[15px] font-medium">Your products & services</h3>
                    </div>
                    <span className="text-[11px] text-[var(--hm-text-tertiary)] bg-[var(--hm-bg-secondary)] px-2.5 py-0.5 rounded-md">
                      {products.length} product{products.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {products.map((product, i) => (
                    <div key={i} className="border border-[var(--hm-border)] rounded-xl mb-3 overflow-hidden">
                      <div
                        className="flex items-center justify-between px-4 py-3 bg-[var(--hm-bg-secondary)] cursor-pointer"
                        onClick={() => setExpandedProduct(expandedProduct === i ? null : i)}
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-[22px] h-[22px] rounded-[5px] bg-[var(--hm-accent)] flex items-center justify-center text-[11px] font-medium text-white">
                            {i + 1}
                          </div>
                          <span className="text-[13px] font-medium">
                            {product.name || "New product"}
                          </span>
                          {product.scope && (
                            <span className="text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-[var(--hm-accent)]">
                              {product.scope === "global" ? "Global" : "Specific"}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => { e.stopPropagation(); removeProduct(i); }}
                            className="text-[11px] text-red-400 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition-all"
                            title="Remove product"
                          >
                            Remove
                          </button>
                          <svg
                            width="13" height="13" viewBox="0 0 16 16" fill="none"
                            className={`transition-transform ${expandedProduct === i ? "rotate-90" : ""}`}
                          >
                            <path d="M6 4l4 4-4 4" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      </div>

                      {expandedProduct === i && (
                        <div className="p-4 border-t border-[var(--hm-border)] space-y-3 animate-fade-in-fast">
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Product name *</label>
                            <input
                              type="text"
                              value={product.name}
                              onChange={(e) => updateProduct(i, "name", e.target.value)}
                              placeholder="e.g., Carrier Allocation Engine"
                              className="w-full text-[13px]"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Description *</label>
                            <textarea
                              value={product.description}
                              onChange={(e) => updateProduct(i, "description", e.target.value)}
                              placeholder="What does this product do?"
                              className="w-full h-[56px] resize-y text-[13px]"
                            />
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Category</label>
                              <select
                                value={product.category}
                                onChange={(e) => updateProduct(i, "category", e.target.value)}
                                className="w-full h-[38px] text-[13px] cursor-pointer"
                              >
                                <option value="core">Core Product</option>
                                <option value="addon">Add-on</option>
                                <option value="service">Service</option>
                                <option value="module">Platform Module</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Classification</label>
                              <div className="flex border border-[var(--hm-border)] rounded-lg overflow-hidden h-[34px]">
                                <button
                                  onClick={() => updateProduct(i, "classification", "painkiller")}
                                  className={`flex-1 text-xs font-medium ${product.classification === "painkiller" ? "bg-[var(--hm-accent)] text-white" : "text-[var(--hm-text-tertiary)]"}`}
                                >
                                  Painkiller
                                </button>
                                <button
                                  onClick={() => updateProduct(i, "classification", "vitamin")}
                                  className={`flex-1 text-xs border-l border-[var(--hm-border)] ${product.classification === "vitamin" ? "bg-[var(--hm-accent)] text-white" : "text-[var(--hm-text-tertiary)]"}`}
                                >
                                  Vitamin
                                </button>
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Availability *</label>
                            <div className="flex border border-[var(--hm-border)] rounded-lg overflow-hidden h-[34px] max-w-[320px] mb-2">
                              <button
                                onClick={() => updateProduct(i, "scope", "global")}
                                className={`flex-1 text-xs font-medium ${product.scope === "global" ? "bg-[var(--hm-accent)] text-white" : "text-[var(--hm-text-tertiary)]"}`}
                              >
                                All markets
                              </button>
                              <button
                                onClick={() => updateProduct(i, "scope", "specific")}
                                className={`flex-1 text-xs border-l border-[var(--hm-border)] ${product.scope === "specific" ? "bg-[var(--hm-accent)] text-white" : "text-[var(--hm-text-tertiary)]"}`}
                              >
                                Specific markets
                              </button>
                            </div>
                            {product.scope === "specific" && markets.filter(m => m.type === "primary").length > 0 && (
                              <div className="p-2.5 bg-[var(--hm-bg-secondary)] rounded-lg animate-fade-in-fast">
                                <p className="text-[11px] text-[var(--hm-text-tertiary)] mb-2">Select from your defined markets:</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {markets.filter(m => m.type === "primary").map((m) => (
                                    <label key={m.name} className="inline-flex items-center gap-1.5 px-2.5 py-1 border border-[var(--hm-border)] rounded-md text-xs cursor-pointer hover:border-[var(--hm-accent)]">
                                      <input
                                        type="checkbox"
                                        checked={product.markets.includes(m.name)}
                                        onChange={(e) => {
                                          const ids = e.target.checked
                                            ? [...product.markets, m.name]
                                            : product.markets.filter((id) => id !== m.name);
                                          updateProduct(i, "markets", ids);
                                        }}
                                        className="w-3 h-3"
                                      />
                                      {m.name}
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Key features</label>
                            <div className="flex flex-wrap gap-1.5 p-2 border border-[var(--hm-border)] rounded-lg min-h-[34px] items-center">
                              {product.features.map((f, fi) => (
                                <span key={fi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[var(--hm-bg-secondary)] rounded-md text-[11px]">
                                  {f}
                                  <button
                                    onClick={() => updateProduct(i, "features", product.features.filter((_, idx) => idx !== fi))}
                                    className="opacity-40 hover:opacity-100"
                                  >
                                    ×
                                  </button>
                                </span>
                              ))}
                              <input
                                type="text"
                                value={expandedProduct === i ? featureInput : ""}
                                onChange={(e) => setFeatureInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" && featureInput.trim()) {
                                    updateProduct(i, "features", [...product.features, featureInput.trim()]);
                                    setFeatureInput("");
                                  }
                                }}
                                placeholder="Add..."
                                className="flex-1 min-w-[60px] border-none shadow-none text-[11px] p-1"
                                style={{ boxShadow: "none" }}
                              />
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}

                  <button
                    onClick={addProduct}
                    className="w-full h-[46px] flex items-center justify-center gap-2 border-2 border-dashed border-[var(--hm-border)] rounded-xl text-[13px] text-[var(--hm-text-secondary)] hover:border-[var(--hm-accent)] hover:text-[var(--hm-accent)] hover:bg-blue-50 transition-all"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                    Add a product or service
                  </button>
                </div>
              </>
            )}

            {/* ═══════ STEP 2: CUSTOMERS & PERSONAS ═══════ */}
            {currentStep === 2 && (
              <>
                <h2 className="text-[22px] font-medium mb-1.5">Customers & buyer personas</h2>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  Define who you sell to and who makes the buying decisions.
                </p>

                {/* ICP */}
                <div className="p-5 border border-[var(--hm-border)] rounded-xl mb-7">
                  <div className="flex items-center gap-2 mb-4">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <circle cx="8" cy="8" r="5" stroke="#4361ee" strokeWidth="1.1" />
                      <circle cx="8" cy="8" r="2.5" stroke="#4361ee" strokeWidth="1.1" />
                      <circle cx="8" cy="8" r="0.8" fill="#4361ee" />
                    </svg>
                    <h3 className="text-[15px] font-medium">Target customer profile</h3>
                  </div>

                  <div>
                    <label className="block text-xs text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                      Ideal customer profile (ICP) <span className="text-red-400">*</span>
                    </label>
                    <textarea
                      value={icpDescription}
                      onChange={(e) => setIcpDescription(e.target.value)}
                      placeholder="Describe your ideal customer — company size, industry, challenges, order volume, etc."
                      className="w-full h-[80px] resize-y text-[13px]"
                    />
                  </div>
                </div>

                {/* Personas */}
                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-medium">Buyer personas</h3>
                  <span className="text-[11px] text-[var(--hm-text-tertiary)] bg-[var(--hm-bg-secondary)] px-2.5 py-0.5 rounded-md">
                    {personas.length} persona{personas.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {personas.map((persona, i) => (
                  <div key={i} className="border border-[var(--hm-border)] rounded-xl mb-3 overflow-hidden">
                    <div
                      onClick={() => setExpandedPersona(expandedPersona === i ? null : i)}
                      className="flex items-center justify-between px-4 py-3 bg-[var(--hm-bg-secondary)] cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-[var(--hm-accent)]">
                          {persona.title ? persona.title.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() : "?"}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">{persona.title || "New persona"}</p>
                          {persona.seniority && <p className="text-[11px] text-[var(--hm-text-tertiary)]">{persona.seniority} · {persona.department}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); removePersona(i); }}
                          className="text-[11px] text-red-400 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition-all"
                          title="Remove persona"
                        >
                          Remove
                        </button>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={`transition-transform ${expandedPersona === i ? "rotate-90" : ""}`}>
                          <path d="M6 4l4 4-4 4" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>

                    {expandedPersona === i && (
                      <div className="p-4 border-t border-[var(--hm-border)] space-y-3 animate-fade-in-fast">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Role / title *</label>
                            <input type="text" value={persona.title} onChange={(e) => updatePersona(i, "title", e.target.value)} placeholder="e.g., VP of Operations" className="w-full text-[13px]" />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Department *</label>
                            <select value={persona.department} onChange={(e) => updatePersona(i, "department", e.target.value)} className="w-full h-[38px] text-[13px] cursor-pointer">
                              <option value="">Select...</option>
                              {DEPARTMENTS.map((d) => (<option key={d} value={d}>{d}</option>))}
                            </select>
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Seniority *</label>
                          <div className="flex flex-wrap gap-1.5">
                            {SENIORITY_LEVELS.map((s) => (
                              <button key={s} onClick={() => updatePersona(i, "seniority", s)}
                                className={`px-3.5 py-1.5 rounded-md text-xs cursor-pointer border ${persona.seniority === s ? "border-[var(--hm-accent)] bg-[var(--hm-accent)] text-white font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                              >{s}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Pain points *</label>
                          <textarea value={persona.painPoints} onChange={(e) => updatePersona(i, "painPoints", e.target.value)} placeholder="What challenges does this persona face?" className="w-full h-[52px] resize-y text-[13px]" />
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">How our product helps *</label>
                          <textarea value={persona.howWeHelp} onChange={(e) => updatePersona(i, "howWeHelp", e.target.value)} placeholder="How does your product solve their problems?" className="w-full h-[52px] resize-y text-[13px]" />
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Content preferences</label>
                          <div className="flex flex-wrap gap-1.5">
                            {CONTENT_PREFS.map((cp) => (
                              <button key={cp} onClick={() => {
                                const prefs = persona.contentPrefs.includes(cp) ? persona.contentPrefs.filter(p => p !== cp) : [...persona.contentPrefs, cp];
                                updatePersona(i, "contentPrefs", prefs);
                              }}
                                className={`px-3 py-1 rounded-md text-[11px] cursor-pointer border ${persona.contentPrefs.includes(cp) ? "border-[var(--hm-accent)] bg-[var(--hm-accent)] text-white" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)]"}`}
                              >{cp}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <button onClick={addPersona}
                  className="w-full h-[46px] flex items-center justify-center gap-2 border-2 border-dashed border-[var(--hm-border)] rounded-xl text-[13px] text-[var(--hm-text-secondary)] hover:border-[var(--hm-accent)] hover:text-[var(--hm-accent)] hover:bg-blue-50 transition-all"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  Add a persona
                </button>
              </>
            )}

            {/* ═══════ STEP 3: COMPETITION ═══════ */}
            {currentStep === 3 && (
              <>
                <h2 className="text-[22px] font-medium mb-1.5">Competitive landscape</h2>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  Map out who you compete against and what makes you different.
                </p>

                <div className="flex items-center justify-between mb-3.5">
                  <h3 className="text-[15px] font-medium">Your competitors</h3>
                  <span className="text-[11px] text-[var(--hm-text-tertiary)] bg-[var(--hm-bg-secondary)] px-2.5 py-0.5 rounded-md">
                    {competitors.length} competitor{competitors.length !== 1 ? "s" : ""}
                  </span>
                </div>

                {competitors.map((comp, i) => (
                  <div key={i} className="border border-[var(--hm-border)] rounded-xl mb-3 overflow-hidden">
                    <div
                      onClick={() => setExpandedCompetitor(expandedCompetitor === i ? null : i)}
                      className="flex items-center justify-between px-4 py-3 bg-[var(--hm-bg-secondary)] cursor-pointer"
                    >
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-[13px] font-medium text-red-600">
                          {comp.name ? comp.name[0].toUpperCase() : "?"}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium">{comp.name || "New competitor"}</p>
                          {comp.website && <p className="text-[11px] text-[var(--hm-text-tertiary)]">{comp.website}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeCompetitor(i); }}
                          className="text-[11px] text-red-400 hover:text-red-600 px-2 py-0.5 rounded hover:bg-red-50 transition-all"
                          title="Remove competitor"
                        >
                          Remove
                        </button>
                        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" className={`transition-transform ${expandedCompetitor === i ? "rotate-90" : ""}`}>
                          <path d="M6 4l4 4-4 4" stroke="#999" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </div>
                    </div>

                    {expandedCompetitor === i && (
                      <div className="p-4 border-t border-[var(--hm-border)] space-y-3 animate-fade-in-fast">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Name *</label>
                            <input type="text" value={comp.name} onChange={(e) => updateCompetitor(i, "name", e.target.value)} placeholder="e.g., Narvar" className="w-full text-[13px]" />
                          </div>
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Website</label>
                            <input type="text" value={comp.website} onChange={(e) => updateCompetitor(i, "website", e.target.value)} placeholder="narvar.com" className="w-full text-[13px]" />
                          </div>
                        </div>
                        {markets.filter(m => m.type === "primary").length > 0 && (
                          <div>
                            <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Market overlap</label>
                            <div className="flex flex-wrap gap-1.5">
                              {markets.filter(m => m.type === "primary").map((m) => (
                                <label key={m.name} className={`inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-md text-xs cursor-pointer ${comp.marketOverlap.includes(m.name) ? "border-[var(--hm-accent)] bg-blue-50 text-[var(--hm-accent)]" : "border-[var(--hm-border)]"}`}>
                                  <input type="checkbox" checked={comp.marketOverlap.includes(m.name)}
                                    onChange={(e) => {
                                      const overlap = e.target.checked ? [...comp.marketOverlap, m.name] : comp.marketOverlap.filter(n => n !== m.name);
                                      updateCompetitor(i, "marketOverlap", overlap);
                                    }} className="w-3 h-3"
                                  />
                                  {m.name}
                                </label>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">Their positioning</label>
                          <textarea value={comp.positioning} onChange={(e) => updateCompetitor(i, "positioning", e.target.value)} placeholder="What are they known for?" className="w-full h-[52px] resize-y text-[13px]" />
                        </div>
                        <div>
                          <label className="block text-xs text-[var(--hm-text-secondary)] mb-1 font-medium">How we differentiate *</label>
                          <textarea value={comp.differentiator} onChange={(e) => updateCompetitor(i, "differentiator", e.target.value)} placeholder="What makes you better or different?" className="w-full h-[52px] resize-y text-[13px]" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                <button onClick={addCompetitor}
                  className="w-full h-[46px] flex items-center justify-center gap-2 border-2 border-dashed border-[var(--hm-border)] rounded-xl text-[13px] text-[var(--hm-text-secondary)] hover:border-[var(--hm-accent)] hover:text-[var(--hm-accent)] hover:bg-blue-50 transition-all mb-7"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                  Add a competitor
                </button>

                <div className="p-5 border border-[var(--hm-border)] rounded-xl">
                  <div className="flex items-center gap-2 mb-3">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 1l2 4h4l-3 3 1 4-4-2-4 2 1-4-3-3h4z" stroke="#4361ee" strokeWidth="1.1" />
                    </svg>
                    <h3 className="text-[15px] font-medium">Your competitive moat</h3>
                  </div>
                  <textarea
                    value={competitiveMoat}
                    onChange={(e) => setCompetitiveMoat(e.target.value)}
                    placeholder="What is your unfair advantage that competitors cannot easily replicate?"
                    className="w-full h-[88px] resize-y text-[13px]"
                  />
                </div>
              </>
            )}

            {/* ═══════ STEP 4: BRAND IDENTITY ═══════ */}
            {currentStep === 4 && (
              <>
                <h2 className="text-[22px] font-medium mb-1.5">Brand identity & voice</h2>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  This is what makes your content sound like you.
                </p>

                {/* Personality traits */}
                <div className="mb-7">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-2 font-medium">
                    Brand personality traits <span className="text-red-400">*</span>
                    <span className="font-normal text-[var(--hm-text-tertiary)]"> — select up to 5</span>
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {PERSONALITY_TRAITS.map((trait) => (
                      <button key={trait}
                        onClick={() => {
                          if (brand.traits.includes(trait)) {
                            setBrand({ ...brand, traits: brand.traits.filter(t => t !== trait) });
                          } else if (brand.traits.length < 5) {
                            setBrand({ ...brand, traits: [...brand.traits, trait] });
                          }
                        }}
                        className={`px-4 py-[7px] rounded-full text-xs cursor-pointer border transition-all ${brand.traits.includes(trait) ? "border-[var(--hm-accent)] bg-[var(--hm-accent)] text-white font-medium" : "border-[var(--hm-border)] text-[var(--hm-text-secondary)] hover:border-[var(--hm-accent)]"}`}
                      >
                        {trait}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-[var(--hm-text-tertiary)] mt-2">{brand.traits.length} of 5 selected</p>
                </div>

                {/* Archetype */}
                <div className="mb-7">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-2 font-medium">
                    Brand archetype <span className="text-red-400">*</span>
                    <span className="font-normal text-[var(--hm-text-tertiary)]"> — select one</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {(showMoreArchetypes ? ARCHETYPES : ARCHETYPES.slice(0, 6)).map((arch) => (
                      <button key={arch.name}
                        onClick={() => setBrand({ ...brand, archetype: arch.name })}
                        className={`p-3 rounded-lg text-left transition-all ${brand.archetype === arch.name ? "border-2 border-[var(--hm-accent)] bg-blue-50" : "border border-[var(--hm-border)] hover:border-[var(--hm-accent)]"}`}
                      >
                        <p className={`text-[13px] font-medium ${brand.archetype === arch.name ? "text-[var(--hm-accent)]" : ""}`}>{arch.name}</p>
                        <p className={`text-[11px] mt-0.5 ${brand.archetype === arch.name ? "text-[var(--hm-accent)]" : "text-[var(--hm-text-tertiary)]"}`}>{arch.desc}</p>
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setShowMoreArchetypes(!showMoreArchetypes)} className="text-xs text-[var(--hm-accent)] mt-2 hover:underline">
                    {showMoreArchetypes ? "Show fewer" : "Show all 12 archetypes"}
                  </button>
                </div>

                {/* Tone sliders */}
                <div className="mb-7">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-3 font-medium">
                    Brand tone spectrum <span className="text-red-400">*</span>
                  </label>
                  <div className="space-y-5">
                    {[
                      { key: "toneFormal" as const, left: "Formal", right: "Casual", labels: ["Very formal", "Leaning formal", "Balanced", "Leaning casual", "Very casual"] as [string, string, string, string, string] },
                      { key: "toneTechnical" as const, left: "Technical", right: "Simple", labels: ["Very technical", "Technical-leaning", "Balanced", "Leaning simple", "Very simple"] as [string, string, string, string, string] },
                      { key: "toneSerious" as const, left: "Serious", right: "Playful", labels: ["Very serious", "Mostly serious", "Balanced", "Slightly playful", "Very playful"] as [string, string, string, string, string] },
                      { key: "toneCorporate" as const, left: "Corporate", right: "Conversational", labels: ["Very corporate", "Leaning corporate", "Balanced", "Conversational", "Very conversational"] as [string, string, string, string, string] },
                    ].map((slider) => (
                      <div key={slider.key}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[11px] text-[var(--hm-text-tertiary)]">{slider.left}</span>
                          <span className="text-[11px] text-[var(--hm-text-tertiary)]">{slider.right}</span>
                        </div>
                        <input
                          type="range" min="0" max="100"
                          value={brand[slider.key]}
                          onChange={(e) => setBrand({ ...brand, [slider.key]: parseInt(e.target.value) })}
                          className="w-full"
                        />
                        <p className="text-[11px] text-[var(--hm-accent)] text-center mt-1">
                          {getToneLabel(brand[slider.key], slider.labels)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Voice description */}
                <div className="mb-7">
                  <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">
                    Describe your brand voice <span className="font-normal text-[var(--hm-text-tertiary)]">(optional)</span>
                  </label>
                  <textarea
                    value={brand.voiceDescription}
                    onChange={(e) => setBrand({ ...brand, voiceDescription: e.target.value })}
                    placeholder="In your own words, how should your brand sound?"
                    className="w-full h-[72px] resize-y text-[13px]"
                  />
                </div>

                {/* Words we use / avoid */}
                <div className="grid grid-cols-2 gap-4 mb-7">
                  <div>
                    <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Words we use</label>
                    <div className="flex flex-wrap gap-1 p-2 border border-[var(--hm-border)] rounded-lg min-h-[60px] items-start content-start">
                      {brand.wordsWeUse.map((w, wi) => (
                        <span key={wi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 rounded-md text-[11px] text-emerald-700">
                          {w}<button onClick={() => setBrand({ ...brand, wordsWeUse: brand.wordsWeUse.filter((_, idx) => idx !== wi) })} className="opacity-60 hover:opacity-100">×</button>
                        </span>
                      ))}
                      <input type="text" value={useWordInput} onChange={(e) => setUseWordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && useWordInput.trim()) { setBrand({ ...brand, wordsWeUse: [...brand.wordsWeUse, useWordInput.trim()] }); setUseWordInput(""); } }}
                        placeholder="Add word..." className="flex-1 min-w-[60px] border-none shadow-none text-[11px] p-1" style={{ boxShadow: "none" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] text-[var(--hm-text-secondary)] mb-1.5 font-medium">Words we avoid</label>
                    <div className="flex flex-wrap gap-1 p-2 border border-[var(--hm-border)] rounded-lg min-h-[60px] items-start content-start">
                      {brand.wordsWeAvoid.map((w, wi) => (
                        <span key={wi} className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 rounded-md text-[11px] text-red-600">
                          {w}<button onClick={() => setBrand({ ...brand, wordsWeAvoid: brand.wordsWeAvoid.filter((_, idx) => idx !== wi) })} className="opacity-60 hover:opacity-100">×</button>
                        </span>
                      ))}
                      <input type="text" value={avoidWordInput} onChange={(e) => setAvoidWordInput(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && avoidWordInput.trim()) { setBrand({ ...brand, wordsWeAvoid: [...brand.wordsWeAvoid, avoidWordInput.trim()] }); setAvoidWordInput(""); } }}
                        placeholder="Add word..." className="flex-1 min-w-[60px] border-none shadow-none text-[11px] p-1" style={{ boxShadow: "none" }}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* ═══════ STEP 5: REVIEW ═══════ */}
            {currentStep === 5 && (
              <>
                <h2 className="text-[22px] font-medium mb-1.5">Review your HiveMind setup</h2>
                <p className="text-sm text-[var(--hm-text-secondary)] mb-8 leading-relaxed">
                  Here&apos;s everything you&apos;ve configured. Review and activate your workspace.
                </p>

                {/* Summary cards */}
                {[
                  { title: "Company", detail: `${orgInfo.name} · ${company.industry || "No industry"} · ${company.size || "No size"}`, complete: !!company.description },
                  { title: "Markets & products", detail: `${markets.length} market${markets.length !== 1 ? "s" : ""} · ${products.length} product${products.length !== 1 ? "s" : ""}`, complete: markets.length > 0 },
                  { title: "Customers & personas", detail: `${personas.length} persona${personas.length !== 1 ? "s" : ""}`, complete: personas.length > 0 },
                  { title: "Competition", detail: `${competitors.length} competitor${competitors.length !== 1 ? "s" : ""}`, complete: competitors.length > 0 },
                  { title: "Brand identity", detail: `${brand.traits.length} traits · ${brand.archetype || "No archetype"}`, complete: brand.traits.length > 0 },
                ].map((section, i) => (
                  <div key={i} className="border border-[var(--hm-border)] rounded-xl mb-2.5 overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <p className="text-sm font-medium">{section.title}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] px-2 py-0.5 rounded-md font-medium ${section.complete ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                          {section.complete ? "Complete" : "Incomplete"}
                        </span>
                        <button onClick={() => { setStepErrors([]); setCurrentStep(i); }} className="text-[11px] text-[var(--hm-accent)] hover:underline">
                          Edit
                        </button>
                      </div>
                    </div>
                    <div className="px-5 pb-3.5 pt-0">
                      <p className="text-xs text-[var(--hm-text-tertiary)]">{section.detail}</p>
                    </div>
                  </div>
                ))}

                {/* Completion check */}
                {(() => {
                  const isReady = !!company.description && !!company.industry && !!company.size;
                  return (
                    <div className={`mt-5 p-4 rounded-xl flex items-center gap-3 ${isReady ? "bg-emerald-50 border border-emerald-200" : "bg-amber-50 border border-amber-200"}`}>
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${isReady ? "bg-emerald-500" : "bg-amber-400"}`}>
                        {isReady ? (
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                            <path d="M3 8.5l3.5 3.5 6.5-7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 16 16" fill="none">
                            <path d="M8 5v3M8 10h.01" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{isReady ? "Ready to activate" : "Some required info is missing"}</p>
                        <p className={`text-xs mt-0.5 ${isReady ? "text-emerald-700" : "text-amber-700"}`}>
                          {isReady
                            ? "HiveMind will continue learning from your website and uploads over time."
                            : "Go back and complete the required fields marked with * before activating."}
                        </p>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        </div>

        {/* Bottom bar */}
        <div className="px-9 py-4 border-t border-[var(--hm-border)] flex items-center justify-between">
          <button
            onClick={() => {
              setStepErrors([]);
              if (currentStep > 0) setCurrentStep(currentStep - 1);
              else router.push("/profile-setup");
            }}
            className="h-[38px] px-5 border border-[var(--hm-border)] rounded-lg text-[13px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-all flex items-center gap-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M10 4L6 8l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </button>
          <div className="flex items-center gap-3">
            {/* Skip for optional steps (1=markets/products, 2=customers has required ICP, 3=competition, 4=brand has required fields) */}
            {(currentStep === 1 || currentStep === 3) && (
              <button
                onClick={() => { setStepErrors([]); setCurrentStep(currentStep + 1); window.scrollTo(0, 0); }}
                className="h-[38px] px-4 border border-[var(--hm-border)] rounded-lg text-[13px] text-[var(--hm-text-tertiary)] hover:bg-[var(--hm-bg-secondary)] hover:text-[var(--hm-text-secondary)] transition-all"
              >
                Skip for now
              </button>
            )}
            <button
              onClick={async () => { const r = await saveData(); if (r.ok) router.push("/dashboard"); else { setStepErrors([r.error || "Failed to save. Please try again."]); window.scrollTo(0, 0); } }}
              disabled={saving}
              className="h-[38px] px-5 border border-[var(--hm-border)] rounded-lg text-[13px] text-[var(--hm-text-secondary)] hover:bg-[var(--hm-bg-secondary)] transition-all flex items-center gap-1.5 disabled:opacity-50"
            >
              {saving ? (
                <div className="w-3.5 h-3.5 border-2 border-[var(--hm-border)] border-t-[var(--hm-text-secondary)] rounded-full animate-spin" />
              ) : (
                <>
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                    <path d="M8 1v6M5 4l3-3 3 3M3 10v3a1 1 0 001 1h8a1 1 0 001-1v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Save &amp; finish later
                </>
              )}
            </button>
            <button
              onClick={handleSaveAndContinue}
              disabled={saving}
              className={`h-[38px] px-6 text-white rounded-lg text-[13px] font-medium hover:opacity-90 transition-all flex items-center gap-1.5 disabled:opacity-50 ${currentStep === 5 ? "bg-emerald-500 px-8" : "bg-[var(--hm-accent)]"}`}
            >
              {saving ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : currentStep === 5 ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M2 14l5-2 7-7-3-3-7 7z" stroke="#fff" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Activate HiveMind
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