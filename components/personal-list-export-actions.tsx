"use client";

import { Check, Copy, Download, Share2 } from "lucide-react";
import { useState } from "react";
import type { PersonalListSnapshot } from "@/lib/personal-list";
import { personalListMarkdown } from "@/lib/personal-list-markdown";

export function PersonalListExportActions({ snapshot }: { snapshot: PersonalListSnapshot }) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  async function nativeShare() {
    if (!navigator.share) return;
    await navigator.share({
      title: snapshot.title,
      text: snapshot.introduction || "A reading list from The Book Prize Index",
      url: window.location.href,
    });
  }

  function downloadMarkdown() {
    const markdown = personalListMarkdown(snapshot, window.location.origin);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${filenameFor(snapshot.title)}.md`;
    anchor.click();
    URL.revokeObjectURL(href);
  }

  return (
    <div className="personal-reading-list-actions">
      {typeof navigator !== "undefined" && "share" in navigator ? (
        <button className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" onClick={() => void nativeShare()} type="button">
          <Share2 size={14} />
          Share…
        </button>
      ) : null}
      <button className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" onClick={() => void copyLink()} type="button">
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? "Copied" : "Copy link"}
      </button>
      <button className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" onClick={downloadMarkdown} type="button">
        <Download size={14} />
        Markdown
      </button>
    </div>
  );
}

function filenameFor(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "reading-list";
}
