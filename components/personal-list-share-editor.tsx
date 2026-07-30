"use client";

import { ArrowDown, ArrowUp, Check, Copy, Download, ExternalLink, Share2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { PersonalListSnapshot } from "@/lib/personal-list";
import { personalListMarkdown } from "@/lib/personal-list-markdown";
import type { PersonalBookList, SavedBook } from "@/lib/saved-library-types";

type EditableBook = {
  book: SavedBook;
  included: boolean;
};

type ShareResponse = {
  error?: string;
  snapshot?: PersonalListSnapshot;
  url?: string;
};

const CREATOR_NAME_STORAGE_KEY = "book-prize-list-maker-name";

export function PersonalListShareEditor({ list }: { list: PersonalBookList }) {
  const [open, setOpen] = useState(false);
  const [creatorName, setCreatorName] = useState("");
  const [title, setTitle] = useState(list.title);
  const [introduction, setIntroduction] = useState("");
  const [books, setBooks] = useState<EditableBook[]>(() => list.books.map((book) => ({ book, included: true })));
  const [sharing, setSharing] = useState(false);
  const [shareUrl, setShareUrl] = useState("");
  const [snapshot, setSnapshot] = useState<PersonalListSnapshot | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const includedCount = books.filter((item) => item.included).length;
  const draftKey = useMemo(
    () => JSON.stringify([creatorName, title, introduction, books.map((item) => [item.book.bookId, item.included])]),
    [books, creatorName, introduction, title],
  );

  useEffect(() => {
    setCreatorName(localStorage.getItem(CREATOR_NAME_STORAGE_KEY) ?? "");
  }, []);

  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  useEffect(() => {
    setShareUrl("");
    setSnapshot(null);
    setCopied(false);
  }, [draftKey]);

  function moveBook(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= books.length) return;
    setBooks((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function toggleBook(bookId: string) {
    setBooks((current) => current.map((item) =>
      item.book.bookId === bookId ? { ...item, included: !item.included } : item
    ));
  }

  async function createShareLink() {
    setSharing(true);
    setError("");
    try {
      const response = await fetch("/api/personal-lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: {
            creatorName,
            introduction,
            results: books.filter((item) => item.included).map((item) => ({ bookId: item.book.bookId })),
            title,
          },
        }),
      });
      const payload = await response.json().catch(() => ({})) as ShareResponse;
      if (!response.ok || !payload.url || !payload.snapshot) {
        throw new Error(payload.error ?? "The stable link could not be created.");
      }
      setShareUrl(payload.url);
      setSnapshot(payload.snapshot);
      localStorage.setItem(CREATOR_NAME_STORAGE_KEY, creatorName.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The stable link could not be created.");
    } finally {
      setSharing(false);
    }
  }

  async function copyLink() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  async function nativeShare() {
    if (!shareUrl || !navigator.share) return;
    await navigator.share({
      title: snapshot?.title ?? title,
      text: introduction || `A reading list from The Book Prize Index`,
      url: shareUrl,
    });
  }

  function downloadMarkdown() {
    if (!snapshot) return;
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
    <>
      <button
        className="personal-list-share-trigger focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm"
        disabled={!list.books.length}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Share2 size={14} />
        Share list
      </button>
      {open ? (
        <div className="semantic-details-overlay" role="presentation">
          <button aria-label="Close list editor" className="semantic-details-backdrop" onClick={() => setOpen(false)} type="button" />
          <section aria-labelledby="personal-list-share-title" aria-modal="true" className="personal-list-share-modal" role="dialog">
            <header className="personal-list-share-header">
              <div>
                <p className="filter-label">Share a frozen edition</p>
                <h2 id="personal-list-share-title">Prepare this list</h2>
                <p>Choose what readers will see. Your private list will not be changed.</p>
              </div>
              <button aria-label="Close" className="focus-ring grid h-9 w-9 shrink-0 place-items-center border hairline transition hover:bg-[var(--panel)]" onClick={() => setOpen(false)} type="button">
                <X size={15} />
              </button>
            </header>

            <div className="personal-list-editor-fields">
              <label>
                <span>Your name</span>
                <input
                  autoComplete="name"
                  maxLength={80}
                  onChange={(event) => setCreatorName(event.target.value)}
                  placeholder="Name shown on the shared list"
                  value={creatorName}
                />
              </label>
              <label>
                <span>Title</span>
                <input maxLength={120} onChange={(event) => setTitle(event.target.value)} value={title} />
              </label>
              <label className="personal-list-introduction-field">
                <span>Introduction <small>Optional</small></span>
                <textarea
                  maxLength={1_200}
                  onChange={(event) => setIntroduction(event.target.value)}
                  placeholder="Add a short note for readers"
                  rows={4}
                  value={introduction}
                />
                <small>{introduction.length.toLocaleString()} / 1,200</small>
              </label>
            </div>

            <div className="personal-list-editor-heading">
              <div>
                <p className="filter-label">Books and order</p>
                <p>{includedCount.toLocaleString()} of {books.length.toLocaleString()} selected</p>
              </div>
              <button className="personal-list-select-all focus-ring" onClick={() => {
                const includeAll = includedCount !== books.length;
                setBooks((current) => current.map((item) => ({ ...item, included: includeAll })));
              }} type="button">
                {includedCount === books.length ? "Clear all" : "Select all"}
              </button>
            </div>

            <ol className="personal-list-editor-books">
              {books.map((item, index) => (
                <li className={item.included ? "" : "is-excluded"} key={item.book.bookId}>
                  <label className="personal-list-book-select">
                    <input
                      checked={item.included}
                      onChange={() => toggleBook(item.book.bookId)}
                      type="checkbox"
                    />
                    <span aria-hidden="true">{item.included ? <Check size={13} /> : null}</span>
                    <span className="sr-only">{item.included ? "Exclude" : "Include"} {item.book.title}</span>
                  </label>
                  <span className="personal-list-editor-rank">{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{item.book.title}</strong>
                    <small>{item.book.authors.join(", ") || "Unknown author"}</small>
                  </div>
                  <div className="personal-list-reorder">
                    <button aria-label={`Move ${item.book.title} up`} className="focus-ring" disabled={index === 0} onClick={() => moveBook(index, -1)} type="button">
                      <ArrowUp size={14} />
                    </button>
                    <button aria-label={`Move ${item.book.title} down`} className="focus-ring" disabled={index === books.length - 1} onClick={() => moveBook(index, 1)} type="button">
                      <ArrowDown size={14} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>

            {shareUrl ? (
              <div className="personal-list-share-result">
                <div>
                  <p className="filter-label">Stable link created</p>
                  <p>This exact title, introduction, selection, and order are now frozen.</p>
                </div>
                <input aria-label="Stable reading-list link" readOnly value={shareUrl} />
                <div>
                  <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={() => void copyLink()} type="button">
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  {typeof navigator !== "undefined" && "share" in navigator ? (
                    <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={() => void nativeShare()} type="button">
                      <Share2 size={14} />
                      Share…
                    </button>
                  ) : null}
                  <a className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" href={shareUrl} rel="noreferrer" target="_blank">
                    <ExternalLink size={14} />
                    Open
                  </a>
                  <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" onClick={downloadMarkdown} type="button">
                    <Download size={14} />
                    Markdown
                  </button>
                </div>
              </div>
            ) : null}
            {error ? <p className="personal-list-share-error" role="alert">{error}</p> : null}

            <footer className="personal-list-share-footer">
              <p>Shared editions are unlisted. Creating another after editing produces a new URL.</p>
              {!shareUrl ? (
                <button
                  className="semantic-share-primary focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm"
                  disabled={sharing || !creatorName.trim() || !title.trim() || includedCount === 0}
                  onClick={() => void createShareLink()}
                  type="button"
                >
                  <Share2 size={14} />
                  {sharing ? "Creating link…" : "Create stable link"}
                </button>
              ) : null}
            </footer>
          </section>
        </div>
      ) : null}
    </>
  );
}

function filenameFor(title: string) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 72) || "reading-list";
}
