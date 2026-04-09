/**
 * Client-side SEO scoring engine.
 * Pure functions — no API calls, runs entirely in the browser.
 */

export interface ChecklistItem {
  id: string;
  label: string;
  passed: boolean;
  warning?: boolean;        // yellow — partial pass
  value?: string;
  weight: number;
  detail: string;
  fix: string;
  jumpText?: string;        // text to find in content when clicked
}

export interface KeywordDensity {
  keyword: string;
  count: number;
  density: number;
  isPrimary: boolean;
  inTitle: boolean;
  inH2: boolean;
}

export interface SeoAnalysis {
  score: number;
  grade: "Excellent" | "Good" | "Needs work" | "Poor";
  checklist: ChecklistItem[];
  keywordDensity: KeywordDensity[];
  wordCount: number;
  readingTime: number;
  readingLevel: number;
  titleText: string;
  h2Count: number;
  passCount: number;
  failCount: number;
  warnCount: number;
}

export interface SeoInput {
  content: string;
  focusKeyword: string;
  secondaryKeywords: string[];
  metaTitle: string;
  metaDescription: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stripMarkdown(md: string): string {
  return md
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`[^`]+`/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\n{2,}/g, "\n");
}

function extractTitle(md: string): string {
  const h1 = md.match(/^#\s+(.+)$/m);
  if (h1) return h1[1].trim();
  return md.split("\n")[0].replace(/^#+\s*/, "").trim().slice(0, 80);
}

function extractH2s(md: string): string[] {
  return (md.match(/^##\s+.+$/gm) ?? []).map(h => h.replace(/^##\s+/, "").trim());
}

function kwCount(text: string, kw: string): number {
  if (!kw.trim()) return 0;
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (text.match(new RegExp(escaped, "gi")) ?? []).length;
}

function firstNWords(text: string, n: number): string {
  return text.split(/\s+/).slice(0, n).join(" ");
}

function gradeLevel(text: string): number {
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 10);
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const syllables = words.reduce((s, w) => s + Math.max(1, (w.match(/[aeiouAEIOU]/g) ?? []).length), 0);
  if (!sentences.length || !words.length) return 8;
  const asl = words.length / sentences.length;
  const asw = syllables / words.length;
  return Math.round(Math.max(1, Math.min(20, 0.39 * asl + 11.8 * asw - 15.59)));
}

// ── Main analyser ─────────────────────────────────────────────────────────────

export function analyzeSeo(input: SeoInput): SeoAnalysis {
  const { content, focusKeyword, secondaryKeywords, metaTitle, metaDescription } = input;

  const plain       = stripMarkdown(content);
  const lower       = plain.toLowerCase();
  const titleText   = extractTitle(content);
  const h2s         = extractH2s(content);
  const wordCount   = plain.trim().split(/\s+/).filter(Boolean).length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));
  const readLevel   = gradeLevel(plain);
  const first150    = firstNWords(plain, 150);

  const fk      = focusKeyword.trim().toLowerCase();
  const fkCount = kwCount(lower, fk);
  const fkDens  = wordCount > 0 ? (fkCount / wordCount) * 100 : 0;

  const effectiveTitle = (metaTitle || titleText || "").trim();
  const titleLen = effectiveTitle.length;
  const descLen  = metaDescription.trim().length;

  const checklist: ChecklistItem[] = [];

  // ── Focus keyword checks (only if keyword set) ────────────────────────────
  if (fk) {
    const inTitle = effectiveTitle.toLowerCase().includes(fk);
    checklist.push({
      id: "kw_title", label: "Focus keyword in title",
      passed: inTitle, weight: 15,
      detail: inTitle ? `"${focusKeyword}" found in title` : `"${focusKeyword}" missing from title`,
      fix: "Add the focus keyword to your H1 / title",
      jumpText: titleText,
    });

    const inIntro = first150.toLowerCase().includes(fk);
    checklist.push({
      id: "kw_intro", label: "Keyword in opening paragraph",
      passed: inIntro, weight: 10,
      detail: inIntro ? "Found in first 150 words" : "Not found in first 150 words",
      fix: "Mention the focus keyword naturally in the first paragraph",
    });

    const inH2 = h2s.some(h => h.toLowerCase().includes(fk));
    checklist.push({
      id: "kw_h2", label: "Keyword in a subheading",
      passed: inH2, weight: 10,
      detail: inH2 ? "Found in at least one H2" : "Not in any H2 headings",
      fix: "Work the focus keyword into one of your section headings",
      jumpText: h2s[0],
    });

    const densOk   = fkDens >= 0.5 && fkDens <= 2.5;
    const densWarn = fkDens > 0 && fkDens < 0.5;
    checklist.push({
      id: "kw_density", label: "Keyword density (0.5 – 2.5%)",
      passed: densOk, warning: densWarn,
      value: fkDens.toFixed(1) + "%",
      weight: 15,
      detail: densOk ? `${fkDens.toFixed(1)}% — optimal`
              : densWarn ? `${fkDens.toFixed(1)}% — too low`
              : fkDens === 0 ? "0% — keyword not found"
              : `${fkDens.toFixed(1)}% — too high (keyword stuffing risk)`,
      fix: fkDens < 0.5
        ? `Use "${focusKeyword}" more throughout the content`
        : "Reduce repetition — swap some instances for synonyms",
    });
  }

  // ── Structure checks ───────────────────────────────────────────────────────
  const wcOk = wordCount >= 800;
  const wcWarn = wordCount >= 500 && wordCount < 800;
  checklist.push({
    id: "word_count", label: "Content length (≥ 800 words)",
    passed: wcOk, warning: wcWarn,
    value: wordCount + " words",
    weight: 10,
    detail: wcOk ? `${wordCount} words — good length`
            : wcWarn ? `${wordCount} words — aim for 800+`
            : `${wordCount} words — too short for strong SEO`,
    fix: "Expand with examples, a FAQ section, or deeper analysis",
  });

  const h2Ok = h2s.length >= 3;
  const h2Warn = h2s.length > 0 && h2s.length < 3;
  checklist.push({
    id: "headings", label: "Subheadings (≥ 3 H2s)",
    passed: h2Ok, warning: h2Warn,
    value: h2s.length + " H2s",
    weight: 10,
    detail: h2Ok ? `${h2s.length} H2 subheadings — well structured`
            : `${h2s.length} subheadings — add more to help readers and bots scan`,
    fix: "Break the content into more sections with descriptive H2 headings",
    jumpText: h2s[0],
  });

  // ── Meta checks ───────────────────────────────────────────────────────────
  const titleOk   = titleLen >= 50 && titleLen <= 60;
  const titleWarn = (titleLen >= 40 && titleLen < 50) || (titleLen > 60 && titleLen <= 70);
  checklist.push({
    id: "meta_title", label: "Title length (50 – 60 chars)",
    passed: titleOk, warning: titleWarn,
    value: titleLen + " chars",
    weight: 10,
    detail: titleOk ? `${titleLen} chars — ideal`
            : titleLen < 40 ? `${titleLen} chars — too short`
            : titleLen > 70 ? `${titleLen} chars — will be truncated in search`
            : `${titleLen} chars — close, fine-tune slightly`,
    fix: titleLen < 50 ? "Make the title more specific and descriptive"
        : "Trim to under 60 characters to avoid SERP truncation",
  });

  const descOk   = descLen >= 120 && descLen <= 160;
  const descWarn = (descLen >= 100 && descLen < 120) || (descLen > 160 && descLen <= 180);
  checklist.push({
    id: "meta_desc", label: "Meta description (120 – 160 chars)",
    passed: descOk, warning: !descOk && descLen > 0 ? descWarn : false,
    value: descLen > 0 ? descLen + " chars" : "Missing",
    weight: 10,
    detail: descLen === 0 ? "No meta description — search engines will pick random text"
            : descOk ? `${descLen} chars — ideal`
            : descLen < 120 ? `${descLen} chars — too short`
            : `${descLen} chars — may be truncated in search results`,
    fix: descLen === 0 ? "Write a compelling 120–160 char summary including the focus keyword"
        : descLen < 120 ? "Expand the description with a benefit-driven sentence"
        : "Trim to under 160 characters",
  });

  // ── Readability ───────────────────────────────────────────────────────────
  const rdOk   = readLevel >= 6 && readLevel <= 12;
  const rdWarn = (readLevel >= 5 && readLevel < 6) || (readLevel > 12 && readLevel <= 14);
  checklist.push({
    id: "readability", label: "Reading level (grade 6 – 12)",
    passed: rdOk, warning: rdWarn,
    value: "Grade " + readLevel,
    weight: 10,
    detail: rdOk ? `Grade ${readLevel} — accessible`
            : readLevel > 12 ? `Grade ${readLevel} — complex for general readers`
            : `Grade ${readLevel} — very simple`,
    fix: readLevel > 12
      ? "Shorten sentences and replace jargon with plain language"
      : "Add more nuance and industry-specific depth",
  });

  // ── Score ─────────────────────────────────────────────────────────────────
  const totalW   = checklist.reduce((s, i) => s + i.weight, 0);
  const earnedW  = checklist.reduce((s, i) => s + (i.passed ? i.weight : i.warning ? i.weight * 0.5 : 0), 0);
  const score    = totalW > 0 ? Math.round((earnedW / totalW) * 100) : 0;
  const grade    = score >= 85 ? "Excellent" : score >= 65 ? "Good" : score >= 45 ? "Needs work" : "Poor";

  // ── Keyword density table ─────────────────────────────────────────────────
  const keywordDensity: KeywordDensity[] = [];
  if (fk) {
    keywordDensity.push({
      keyword: focusKeyword,
      count: fkCount,
      density: parseFloat(fkDens.toFixed(1)),
      isPrimary: true,
      inTitle: effectiveTitle.toLowerCase().includes(fk),
      inH2: h2s.some(h => h.toLowerCase().includes(fk)),
    });
  }
  for (const kw of secondaryKeywords.filter(k => k.trim())) {
    const cnt  = kwCount(lower, kw.toLowerCase());
    const dens = wordCount > 0 ? parseFloat(((cnt / wordCount) * 100).toFixed(1)) : 0;
    keywordDensity.push({
      keyword: kw, count: cnt, density: dens, isPrimary: false,
      inTitle: effectiveTitle.toLowerCase().includes(kw.toLowerCase()),
      inH2: h2s.some(h => h.toLowerCase().includes(kw.toLowerCase())),
    });
  }

  const passCount = checklist.filter(i => i.passed).length;
  const warnCount = checklist.filter(i => !i.passed && i.warning).length;
  const failCount = checklist.filter(i => !i.passed && !i.warning).length;

  return { score, grade, checklist, keywordDensity, wordCount, readingTime, readingLevel: readLevel, titleText, h2Count: h2s.length, passCount, warnCount, failCount };
}
