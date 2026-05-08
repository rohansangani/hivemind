"use client";

type Block =
  | { type: "line"; text: string }
  | { type: "fence"; lines: string[] };

function parseBlocks(content: string): Block[] {
  const raw = content.split("\n");
  const blocks: Block[] = [];
  let inFence = false;
  let fenceLines: string[] = [];

  for (const line of raw) {
    if (line.trim().startsWith("```")) {
      if (inFence) {
        // Close fence — emit as a block
        blocks.push({ type: "fence", lines: fenceLines });
        fenceLines = [];
        inFence = false;
      } else {
        inFence = true;
        fenceLines = [];
      }
    } else if (inFence) {
      fenceLines.push(line);
    } else {
      blocks.push({ type: "line", text: line });
    }
  }
  // Unclosed fence — still emit it
  if (inFence && fenceLines.length > 0) {
    blocks.push({ type: "fence", lines: fenceLines });
  }
  return blocks;
}

export default function MarkdownRenderer({ content }: { content: string }) {
  const blocks = parseBlocks(content);

  return (
    <div className="space-y-1.5">
      {blocks.map((block, i) => {
        if (block.type === "fence") {
          const text = block.lines.join("\n").trim();
          if (!text) return null;
          return (
            <div key={i} className="my-2 px-4 py-3 bg-[#f0f4ff] border border-[#c7d2fe] rounded-xl">
              <p className="text-[13px] font-medium text-[#1e3a8a] leading-relaxed whitespace-pre-wrap">{text}</p>
            </div>
          );
        }

        const line = block.text;
        const trimmed = line.trim();

        // Blank line — section spacer
        if (!trimmed) return <div key={i} className="h-2" />;

        // Headers
        if (trimmed.startsWith("#### ")) return <h4 key={i} className="text-[13px] font-semibold mt-3 mb-0.5 text-[var(--hm-text)]">{parseBold(trimmed.slice(5))}</h4>;
        if (trimmed.startsWith("### "))  return <h3 key={i} className="text-[14px] font-semibold mt-4 mb-1 text-[var(--hm-text)]">{parseBold(trimmed.slice(4))}</h3>;
        if (trimmed.startsWith("## "))   return <h2 key={i} className="text-[15px] font-bold mt-5 mb-1.5 text-[var(--hm-text)] border-b border-[var(--hm-border)] pb-1.5">{parseBold(trimmed.slice(3))}</h2>;
        if (trimmed.startsWith("# "))    return <h1 key={i} className="text-[17px] font-bold mt-5 mb-2 text-[var(--hm-text)]">{parseBold(trimmed.slice(2))}</h1>;

        // Horizontal rule
        if (trimmed === "---" || trimmed === "***" || trimmed === "___") return <hr key={i} className="border-[var(--hm-border)] my-4" />;

        // Blockquote
        if (trimmed.startsWith("> ")) return (
          <div key={i} className="border-l-[3px] border-[#7c3aed]/40 pl-3 py-0.5 bg-[#7c3aed]/[0.04] rounded-r-md">
            <p className="text-[var(--hm-text-secondary)] italic leading-relaxed">{parseBold(trimmed.slice(2))}</p>
          </div>
        );

        // Indented bullet (2+ spaces or tab before -)
        const indentedBullet = line.match(/^(\s{2,}|\t)[*\-]\s(.+)/);
        if (indentedBullet) return (
          <div key={i} className="flex gap-2 ml-6">
            <span className="text-[var(--hm-text-tertiary)] mt-0.5 flex-shrink-0">◦</span>
            <span className="leading-relaxed">{parseBold(indentedBullet[2])}</span>
          </div>
        );

        // Bullet lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return (
          <div key={i} className="flex gap-2.5 ml-1">
            <span className="text-[var(--hm-text-tertiary)] mt-[3px] flex-shrink-0 text-[10px]">●</span>
            <span className="leading-relaxed">{parseBold(trimmed.slice(2))}</span>
          </div>
        );

        // Numbered lists
        const numMatch = trimmed.match(/^(\d+)[.)]\s(.+)/);
        if (numMatch) return (
          <div key={i} className="flex gap-2.5 ml-1">
            <span className="text-[var(--hm-text-tertiary)] min-w-[20px] flex-shrink-0 font-medium">{numMatch[1]}.</span>
            <span className="leading-relaxed">{parseBold(numMatch[2])}</span>
          </div>
        );

        // Source/citation lines
        if (trimmed.startsWith("Source:") || trimmed.startsWith("*Source")) return (
          <p key={i} className="text-[11px] text-[var(--hm-text-tertiary)] mt-3 italic">{parseBold(trimmed)}</p>
        );

        // Bold-only line (likely a label/sub-heading)
        if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) return (
          <p key={i} className="font-semibold leading-relaxed mt-2">{parseBold(trimmed)}</p>
        );

        // Regular paragraph
        return <p key={i} className="leading-relaxed text-[var(--hm-text)]">{parseBold(trimmed)}</p>;
      })}
    </div>
  );
}

function parseBold(text: string): React.ReactNode {
  // Handle **bold**, *italic*, `code`
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    const candidates: Array<{ index: number; len: number; inner: string; type: "bold" | "italic" | "code" }> = [];
    const b = remaining.match(/\*\*(.+?)\*\*/);
    if (b?.index !== undefined) candidates.push({ index: b.index, len: b[0].length, inner: b[1], type: "bold" });
    const it = remaining.match(/(?<!\*)\*([^*]+?)\*(?!\*)/);
    if (it?.index !== undefined) candidates.push({ index: it.index, len: it[0].length, inner: it[1], type: "italic" });
    const c = remaining.match(/`([^`]+?)`/);
    if (c?.index !== undefined) candidates.push({ index: c.index, len: c[0].length, inner: c[1], type: "code" });

    if (candidates.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    candidates.sort((a, z) => a.index - z.index);
    const hit = candidates[0];
    if (hit.index > 0) parts.push(<span key={key++}>{remaining.slice(0, hit.index)}</span>);
    if (hit.type === "bold") parts.push(<strong key={key++} className="font-semibold">{hit.inner}</strong>);
    else if (hit.type === "italic") parts.push(<em key={key++}>{hit.inner}</em>);
    else parts.push(<code key={key++} className="px-1.5 py-0.5 bg-[var(--hm-bg-secondary)] rounded text-[12px] font-mono">{hit.inner}</code>);
    remaining = remaining.slice(hit.index + hit.len);
  }

  return <>{parts}</>;
}
