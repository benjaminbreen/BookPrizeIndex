"use client";

import { Bookmark, Check, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  addBookToPersonalList,
  createPersonalBookList,
  isBookSaved,
  listPersonalBookLists,
  removeBookFromPersonalList,
  removeSavedBook,
  saveBook,
  SAVED_LIBRARY_CHANGED_EVENT,
} from "@/lib/saved-semantic-lists";
import type { PersonalBookList, SavedBookInput } from "@/lib/saved-library-types";

export function SaveBookControl({
  book,
  variant = "page",
}: {
  book: SavedBookInput;
  variant?: "page" | "drawer";
}) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const [lists, setLists] = useState<PersonalBookList[]>([]);
  const [newListTitle, setNewListTitle] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      void Promise.all([isBookSaved(book.bookId), listPersonalBookLists()])
        .then(([nextSaved, nextLists]) => {
          setSaved(nextSaved);
          setLists(nextLists);
          setError("");
        })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Saved items could not be loaded."));
    };
    load();
    window.addEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
    return () => window.removeEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
  }, [book.bookId]);

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

  async function toggleSavedBook() {
    setBusy("saved");
    setError("");
    try {
      if (saved) await removeSavedBook(book.bookId);
      else await saveBook(book);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This book could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function toggleList(list: PersonalBookList) {
    setBusy(list.id);
    setError("");
    try {
      if (list.books.some((candidate) => candidate.bookId === book.bookId)) {
        await removeBookFromPersonalList(list.id, book.bookId);
      } else {
        await addBookToPersonalList(list.id, book);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The list could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function createList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("new-list");
    setError("");
    try {
      await createPersonalBookList(newListTitle, book);
      setNewListTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The list could not be created.");
    } finally {
      setBusy("");
    }
  }

  const triggerClass = variant === "drawer"
    ? "save-book-trigger focus-ring inline-flex w-32 items-center justify-center gap-2 border hairline px-3 py-2 text-sm transition"
    : "save-book-trigger focus-ring inline-flex w-full items-center justify-center gap-2 border hairline px-3 py-2.5 text-sm transition";

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={`${triggerClass} ${saved ? "save-book-trigger-active" : ""}`}
        onClick={() => setOpen(true)}
        type="button"
      >
        <Bookmark aria-hidden="true" fill={saved ? "currentColor" : "none"} size={15} />
        {saved ? "Saved" : "Save book"}
      </button>
      {open && typeof document !== "undefined" ? createPortal((
        <div className="semantic-details-overlay" role="presentation">
          <button aria-label="Close save dialog" className="semantic-details-backdrop" onClick={() => setOpen(false)} type="button" />
          <section aria-labelledby={`save-book-${book.bookId}`} aria-modal="true" className="save-book-modal" role="dialog">
            <div className="flex items-start justify-between gap-4 border-b hairline pb-4">
              <div className="min-w-0">
                <p className="filter-label">Personal library</p>
                <h2 className="mt-2 truncate font-[var(--font-serif)] text-2xl font-light" id={`save-book-${book.bookId}`}>
                  {book.title}
                </h2>
              </div>
              <button aria-label="Close" className="save-book-modal-close focus-ring grid h-8 w-8 shrink-0 place-items-center border hairline transition hover:bg-[var(--panel)]" onClick={() => setOpen(false)} type="button">
                <X size={14} />
              </button>
            </div>

            <div className="save-book-options">
              <button
                className={`save-book-option focus-ring ${saved ? "save-book-option-selected" : ""}`}
                disabled={busy === "saved"}
                onClick={() => void toggleSavedBook()}
                type="button"
              >
                <span>
                  <strong>Saved books</strong>
                  <small>Keep this book in your general reading file.</small>
                </span>
                <span className="save-book-check" aria-hidden="true">{saved ? <Check size={14} /> : null}</span>
              </button>

              <div className="save-book-list-heading">
                <p className="filter-label">Add to a list</p>
                <span>{lists.length.toLocaleString()}</span>
              </div>
              {lists.length ? (
                <div className="save-book-list-options">
                  {lists.map((list) => {
                    const selected = list.books.some((candidate) => candidate.bookId === book.bookId);
                    return (
                      <button
                        className={`save-book-option focus-ring ${selected ? "save-book-option-selected" : ""}`}
                        disabled={busy === list.id}
                        key={list.id}
                        onClick={() => void toggleList(list)}
                        type="button"
                      >
                        <span>
                          <strong>{list.title}</strong>
                          <small>{list.books.length.toLocaleString()} {list.books.length === 1 ? "book" : "books"}</small>
                        </span>
                        <span className="save-book-check" aria-hidden="true">{selected ? <Check size={14} /> : null}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="save-book-no-lists">No personal lists yet. Start one below.</p>
              )}

              <form className="save-book-new-list" onSubmit={(event) => void createList(event)}>
                <label htmlFor={`new-list-${book.bookId}`}>New list</label>
                <div>
                  <input
                    autoComplete="off"
                    id={`new-list-${book.bookId}`}
                    maxLength={80}
                    onChange={(event) => setNewListTitle(event.target.value)}
                    placeholder="Name this list"
                    value={newListTitle}
                  />
                  <button className="save-book-create filter-action focus-ring inline-flex items-center gap-2 px-3 py-2" disabled={busy === "new-list" || !newListTitle.trim()} type="submit">
                    <Plus size={14} />
                    Create
                  </button>
                </div>
              </form>
              {error ? <p className="text-sm text-[var(--accent)]" role="alert">{error}</p> : null}
              <p className="save-book-local-note">Kept in this browser until you share or export.</p>
            </div>
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}
