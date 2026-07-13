"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import MarkdownRenderer from "./MarkdownRenderer";

interface InlineEditableContentProps {
  content: string;
  onSave: (edited: string) => void;
  featureKey: string;
  outputId?: string;
  entityType?: "product" | "persona" | "market" | "competitor";
  entityName?: string;
  disabled?: boolean;
}

export default function InlineEditableContent({
  content,
  onSave,
  featureKey,
  outputId,
  entityType,
  entityName,
  disabled,
}: InlineEditableContentProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(content);
  const [saving, setSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const originalRef = useRef(content);

  useEffect(() => {
    setDraft(content);
    originalRef.current = content;
    setEditing(false);
  }, [content]);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = el.scrollHeight + "px";
    }
  }, []);

  const handleSave = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === originalRef.current) {
      setEditing(false);
      setDraft(originalRef.current);
      return;
    }

    setSaving(true);
    try {
      fetch("/api/edit-signal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          featureKey,
          outputId: outputId || null,
          entityType: entityType || null,
          entityName: entityName || null,
          original: originalRef.current,
          edited: trimmed,
        }),
      }).catch(() => {});

      onSave(trimmed);
      originalRef.current = trimmed;
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDraft(originalRef.current);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancel();
    }
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  if (editing) {
    return (
      <div className="relative">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            <span className="text-[11px] font-medium text-amber-600">Editing</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--hm-text-tertiary)]">Esc to cancel · {navigator.platform.includes("Mac") ? "⌘" : "Ctrl"}+S to save</span>
            <button
              onClick={handleCancel}
              className="h-[26px] px-2.5 text-[11px] text-[var(--hm-text-secondary)] border border-[var(--hm-border)] rounded-md hover:bg-[var(--hm-bg-secondary)] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || draft.trim() === originalRef.current}
              className="h-[26px] px-3 text-[11px] font-medium text-white bg-[#4361ee] rounded-md hover:opacity-90 disabled:opacity-40 transition-all flex items-center gap-1"
            >
              {saving ? (
                <><div className="w-2.5 h-2.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving…</>
              ) : (
                "Save"
              )}
            </button>
          </div>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={e => { setDraft(e.target.value); autoResize(); }}
          onKeyDown={handleKeyDown}
          className="w-full min-h-[200px] p-4 text-[14px] leading-relaxed font-mono bg-white border border-amber-300 rounded-xl focus:outline-none focus:border-[#4361ee] focus:ring-2 focus:ring-[#4361ee]/20 resize-none transition-colors"
          style={{ tabSize: 2 }}
        />
      </div>
    );
  }

  return (
    <div
      className={"group/editable relative cursor-text rounded-xl transition-colors " + (disabled ? "" : "hover:bg-[var(--hm-bg-secondary)]/50")}
      onClick={() => { if (!disabled) setEditing(true); }}
      role={disabled ? undefined : "button"}
      tabIndex={disabled ? undefined : 0}
      onKeyDown={e => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setEditing(true); } }}
    >
      <MarkdownRenderer content={content} />
      {!disabled && (
        <div className="absolute top-0 right-0 opacity-0 group-hover/editable:opacity-100 transition-opacity">
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-white border border-[var(--hm-border)] text-[10px] text-[var(--hm-text-tertiary)] shadow-sm">
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><path d="M4 12l1.5-4L12 2l2 2-6.5 6.5L4 12z" stroke="currentColor" strokeWidth="1.3" /></svg>
            Click to edit
          </span>
        </div>
      )}
    </div>
  );
}
