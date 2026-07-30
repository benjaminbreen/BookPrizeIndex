"use client";

import { Bookmark, Check, Copy, Share2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { SemanticListDraft, SemanticListSnapshot } from "@/lib/semantic-list";
import {
  isSemanticListSaved,
  saveSemanticList,
  SAVED_LISTS_CHANGED_EVENT,
} from "@/lib/saved-semantic-lists";

type SnapshotResponse = {
  error?: string;
  snapshot?: SemanticListSnapshot;
  url?: string;
};

export function SemanticListActions({
  draft,
  initialSnapshot,
  variant = "toolbar",
}: {
  draft: SemanticListDraft;
  initialSnapshot?: SemanticListSnapshot;
  variant?: "toolbar" | "page";
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [prepared, setPrepared] = useState<SemanticListSnapshot | null>(initialSnapshot ?? null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const draftKey = `${draft.query}\u0000${draft.results.map((result) => result.bookId).join("\u0001")}`;

  useEffect(() => {
    setDialogOpen(false);
    setPrepared(initialSnapshot ?? null);
    setSaved(false);
    setShareUrl("");
    setCopied(false);
    setError("");
  }, [draftKey, initialSnapshot]);

  useEffect(() => {
    if (!prepared) return;
    const update = () => void isSemanticListSaved(prepared.id).then(setSaved).catch(() => setSaved(false));
    update();
    window.addEventListener(SAVED_LISTS_CHANGED_EVENT, update);
    return () => window.removeEventListener(SAVED_LISTS_CHANGED_EVENT, update);
  }, [prepared]);

  useEffect(() => {
    if (!dialogOpen) return;
    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDialogOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [dialogOpen]);

  async function prepareSnapshot() {
    if (prepared) return prepared;
    const response = await fetch("/api/semantic-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prepare", draft }),
    });
    const payload = await response.json().catch(() => ({})) as SnapshotResponse;
    if (!response.ok || !payload.snapshot) throw new Error(payload.error ?? "The list could not be prepared.");
    setPrepared(payload.snapshot);
    return payload.snapshot;
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const snapshot = await prepareSnapshot();
      await saveSemanticList(snapshot);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The list could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  async function createShareLink() {
    setSharing(true);
    setError("");
    try {
      const response = await fetch("/api/semantic-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "share", draft }),
      });
      const payload = await response.json().catch(() => ({})) as SnapshotResponse;
      if (!response.ok || !payload.snapshot || !payload.url) throw new Error(payload.error ?? "The share link could not be created.");
      setPrepared(payload.snapshot);
      setShareUrl(payload.url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The share link could not be created.");
    } finally {
      setSharing(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function nativeShare() {
    if (!shareUrl || !navigator.share) return;
    await navigator.share({
      title: prepared?.title ?? "Shared reading list",
      text: prepared ? `${prepared.title} — a frozen list from The Book Prize Index` : undefined,
      url: shareUrl,
    });
  }

  const buttonClass = variant === "page"
    ? "filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm"
    : "semantic-detail-button focus-ring inline-flex items-center gap-2";

  return (
    <>
      <button className={buttonClass} disabled={saving} onClick={() => void save()} type="button">
        {saved ? <Check size={13} /> : <Bookmark size={13} />}
        {saving ? "Saving…" : saved ? "Saved" : "Save"}
      </button>
      <button className={buttonClass} onClick={() => setDialogOpen(true)} type="button">
        <Share2 size={13} />
        Share
      </button>
      {dialogOpen ? (
        <div className="semantic-details-overlay" role="presentation">
          <button aria-label="Close share dialog" className="semantic-details-backdrop" onClick={() => setDialogOpen(false)} type="button" />
          <section aria-labelledby="semantic-share-title" aria-modal="true" className="semantic-share-modal" role="dialog">
            <div className="flex items-start justify-between gap-4 border-b hairline pb-3">
              <div>
                <p className="filter-label">Frozen semantic list</p>
                <h2 className="mt-2 text-xl font-medium" id="semantic-share-title">Share these results</h2>
              </div>
              <button aria-label="Close" className="focus-ring grid h-8 w-8 place-items-center border hairline transition hover:bg-[var(--panel)]" onClick={() => setDialogOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>
            <div className="mt-5 grid gap-4">
              <div>
                <p className="filter-label">List title</p>
                <p className="mt-2 font-[var(--font-serif)] text-2xl font-light leading-tight">
                  {prepared?.title ?? titleFromQuery(draft.query)}
                </p>
              </div>
              <p className="text-sm leading-6 muted">
                This preserves the current interpretation and all {draft.results.length.toLocaleString()} books in their
                present order. Opening the link will not rerun the search.
              </p>
              <p className="semantic-share-privacy">
                The search phrase and interpreted concepts will be visible to anyone with the link. Shared lists are
                unlisted and excluded from search-engine indexing.
              </p>
              {shareUrl ? (
                <div className="semantic-share-result">
                  <label htmlFor="semantic-share-url">Stable link</label>
                  <div>
                    <input id="semantic-share-url" readOnly value={shareUrl} />
                    <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2" onClick={() => void copyLink()} type="button">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ) : null}
              {error ? <p className="text-sm text-[var(--accent)]" role="alert">{error}</p> : null}
              <div className="flex flex-wrap justify-end gap-2 border-t hairline pt-4">
                {!shareUrl ? (
                  <button className="semantic-share-primary focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" disabled={sharing} onClick={() => void createShareLink()} type="button">
                    <Share2 size={14} />
                    {sharing ? "Creating link…" : "Create stable link"}
                  </button>
                ) : (
                  <>
                    {typeof navigator !== "undefined" && "share" in navigator ? (
                      <button className="filter-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" onClick={() => void nativeShare()} type="button">
                        <Share2 size={14} />
                        Share…
                      </button>
                    ) : null}
                    <button className="semantic-share-primary focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" onClick={() => void copyLink()} type="button">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? "Copied" : "Copy link"}
                    </button>
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function titleFromQuery(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
