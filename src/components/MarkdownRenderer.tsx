"use client";

export default function MarkdownRenderer({ content }: { content: string }) {
  const lines = content.split("\n");
  
  return (
    <div className="space-y-2">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-2" />;
        
        // Headers
        if (trimmed.startsWith("### ")) return <h3 key={i} className="text-[14px] font-semibold mt-3 mb-1">{parseBold(trimmed.slice(4))}</h3>;
        if (trimmed.startsWith("## ")) return <h2 key={i} className="text-[15px] font-semibold mt-4 mb-1.5">{parseBold(trimmed.slice(3))}</h2>;
        if (trimmed.startsWith("# ")) return <h1 key={i} className="text-[17px] font-semibold mt-4 mb-2">{parseBold(trimmed.slice(2))}</h1>;
        
        // Horizontal rule
        if (trimmed === "---" || trimmed === "***") return <hr key={i} className="border-[var(--hm-border)] my-3" />;
        
        // Bullet lists
        if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) return <div key={i} className="flex gap-2 ml-1"><span className="text-[var(--hm-text-tertiary)] mt-0.5">&bull;</span><span>{parseBold(trimmed.slice(2))}</span></div>;
        
        // Numbered lists
        const numMatch = trimmed.match(/^(\d+)\.\s(.+)/);
        if (numMatch) return <div key={i} className="flex gap-2 ml-1"><span className="text-[var(--hm-text-tertiary)] min-w-[16px]">{numMatch[1]}.</span><span>{parseBold(numMatch[2])}</span></div>;
        
        // Source/citation lines
        if (trimmed.startsWith("Source:") || trimmed.startsWith("*Source")) return <p key={i} className="text-[11px] text-[var(--hm-text-tertiary)] mt-3 italic">{parseBold(trimmed)}</p>;
        
        // Regular paragraph
        return <p key={i} className="leading-relaxed">{parseBold(trimmed)}</p>;
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
