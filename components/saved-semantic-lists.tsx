"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Bookmark, List, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PersonalListShareEditor } from "@/components/personal-list-share-editor";
import { SaveBookControl } from "@/components/save-book-control";
import { SemanticListView } from "@/components/semantic-list-view";
import type { SemanticListSnapshot } from "@/lib/semantic-list";
import {
  createPersonalBookList,
  getPersonalBookList,
  getSavedSemanticList,
  listPersonalBookLists,
  listSavedBooks,
  listSavedSemanticLists,
  removeBookFromPersonalList,
  removePersonalBookList,
  removeSavedBook,
  removeSavedSemanticList,
  SAVED_LIBRARY_CHANGED_EVENT,
  type SavedSemanticListSummary,
} from "@/lib/saved-semantic-lists";
import type { PersonalBookList, SavedBook } from "@/lib/saved-library-types";

type SavedLibraryState = {
  books: SavedBook[];
  personalLists: PersonalBookList[];
  searchLists: SavedSemanticListSummary[];
};

export function SavedLibraryIndex() {
  const [library, setLibrary] = useState<SavedLibraryState | null>(null);
  const [newListTitle, setNewListTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const load = () => {
      void Promise.all([listSavedBooks(), listPersonalBookLists(), listSavedSemanticLists()])
        .then(([books, personalLists, searchLists]) => {
          setLibrary({ books, personalLists, searchLists });
          setError("");
        })
        .catch((cause) => {
          setError(cause instanceof Error ? cause.message : "Your saved library could not be loaded.");
          setLibrary({ books: [], personalLists: [], searchLists: [] });
        });
    };
    load();
    window.addEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
    return () => window.removeEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
  }, []);

  async function createList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      await createPersonalBookList(newListTitle);
      setNewListTitle("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The list could not be created.");
    } finally {
      setCreating(false);
    }
  }

  if (library === null) return <SavedLibraryLoading />;

  const totalItems = library.books.length + library.personalLists.length + library.searchLists.length;

  return (
    <div className="saved-library">
      <div className="saved-library-metrics" aria-label="Saved library totals">
        <SavedMetric label="Books" value={library.books.length} />
        <SavedMetric label="Personal lists" value={library.personalLists.length} />
        <SavedMetric label="Saved searches" value={library.searchLists.length} />
      </div>

      {error ? <p className="saved-library-error" role="alert">{error}</p> : null}
      {!totalItems ? (
        <div className="saved-library-welcome">
          <Bookmark aria-hidden="true" size={22} />
          <div>
            <h2>No saved items yet</h2>
            <p>Bookmark a book, create a reading list, or freeze the results of a Meaning search.</p>
          </div>
          <Link className="filter-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" href="/books">
            Explore books
            <ArrowRight size={14} />
          </Link>
        </div>
      ) : null}

      <SavedSection
        action={null}
        count={library.books.length}
        description="Individual titles you want to return to."
        icon={<BookOpen size={17} />}
        title="Saved books"
      >
        {library.books.length ? (
          <ol className="saved-book-index">
            {library.books.map((book) => (
              <li key={book.bookId}>
                <Link className="saved-book-cover focus-ring" href={`/books/${book.slug}`}>
                  {book.thumbnailUrl ? <img alt="" src={book.thumbnailUrl} /> : <span>{book.title.slice(0, 1)}</span>}
                </Link>
                <Link className="saved-book-main focus-ring" href={`/books/${book.slug}`}>
                  <strong>{book.title}</strong>
                  <small>
                    {book.authors.join(", ") || "Unknown author"}
                    {book.publicationYear ? ` · ${book.publicationYear}` : ""}
                    {book.primarySubject ? ` · ${book.primarySubject}` : ""}
                  </small>
                </Link>
                <div className="saved-book-manage">
                  <SaveBookControl book={book} variant="drawer" />
                </div>
                <button
                  aria-label={`Remove ${book.title} from saved books`}
                  className="saved-list-remove focus-ring"
                  onClick={() => {
                    if (window.confirm(`Remove “${book.title}” from Saved books?`)) void removeSavedBook(book.bookId);
                  }}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <SavedSectionEmpty>Use the bookmark control on any book page or book sidebar.</SavedSectionEmpty>
        )}
      </SavedSection>

      <SavedSection
        action={(
          <form className="saved-list-create" onSubmit={(event) => void createList(event)}>
            <label className="sr-only" htmlFor="saved-list-title">New list name</label>
            <input
              id="saved-list-title"
              maxLength={80}
              onChange={(event) => setNewListTitle(event.target.value)}
              placeholder="Name a new list"
              value={newListTitle}
            />
            <button className="filter-action focus-ring inline-flex items-center gap-2 px-3 py-2 text-sm" disabled={creating || !newListTitle.trim()} type="submit">
              <Plus size={14} />
              New list
            </button>
          </form>
        )}
        count={library.personalLists.length}
        description="Lists you curate book by book."
        icon={<List size={17} />}
        title="Personal lists"
      >
        {library.personalLists.length ? (
          <ol className="saved-lists-index">
            {library.personalLists.map((list) => (
              <li key={list.id}>
                <Link className="saved-list-main focus-ring" href={`/saved/collections/${list.id}`}>
                  <span className="filter-label">{formatDate(list.updatedAt)}</span>
                  <strong>{list.title}</strong>
                  <small>{list.books.length.toLocaleString()} {list.books.length === 1 ? "book" : "books"} · curated list</small>
                </Link>
                <button
                  aria-label={`Remove ${list.title}`}
                  className="saved-list-remove focus-ring"
                  onClick={() => {
                    if (window.confirm(`Delete “${list.title}”? This will not remove any books from Saved books.`)) void removePersonalBookList(list.id);
                  }}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
                <Link aria-label={`Open ${list.title}`} className="saved-list-open focus-ring" href={`/saved/collections/${list.id}`}>
                  <ArrowRight size={15} />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <SavedSectionEmpty>Create an empty list here, or start one while bookmarking a book.</SavedSectionEmpty>
        )}
      </SavedSection>

      <SavedSection
        action={null}
        count={library.searchLists.length}
        description="Stable snapshots of Meaning-search results."
        icon={<Search size={17} />}
        title="Saved searches"
      >
        {library.searchLists.length ? (
          <ol className="saved-lists-index">
            {library.searchLists.map((list) => (
              <li key={list.id}>
                <Link className="saved-list-main focus-ring" href={`/saved/${list.id}`}>
                  <span className="filter-label">{formatDate(list.savedAt)}</span>
                  <strong>{list.title}</strong>
                  <small>{list.resultCount.toLocaleString()} books · frozen semantic result</small>
                </Link>
                <button
                  aria-label={`Remove ${list.title}`}
                  className="saved-list-remove focus-ring"
                  onClick={() => {
                    if (window.confirm(`Remove “${list.title}” from this device?`)) void removeSavedSemanticList(list.id);
                  }}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
                <Link aria-label={`Open ${list.title}`} className="saved-list-open focus-ring" href={`/saved/${list.id}`}>
                  <ArrowRight size={15} />
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <SavedSectionEmpty>Run a Meaning search, then choose Save after the results settle.</SavedSectionEmpty>
        )}
      </SavedSection>
    </div>
  );
}

export function SavedSemanticListDetail({ id }: { id: string }) {
  const [snapshot, setSnapshot] = useState<SemanticListSnapshot | null | undefined>(undefined);

  useEffect(() => {
    void getSavedSemanticList(id).then((stored) => setSnapshot(stored?.snapshot ?? null)).catch(() => setSnapshot(null));
  }, [id]);

  if (snapshot === undefined) return <SavedLibraryLoading />;
  if (!snapshot) {
    return (
      <MissingSavedItem
        description="Saved searches remain only on the device and browser where they were created."
        title="This search is not saved in this browser."
      />
    );
  }
  return <SemanticListView local snapshot={snapshot} />;
}

export function PersonalBookListDetail({ id }: { id: string }) {
  const [list, setList] = useState<PersonalBookList | null | undefined>(undefined);

  useEffect(() => {
    const load = () => void getPersonalBookList(id).then(setList).catch(() => setList(null));
    load();
    window.addEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
    return () => window.removeEventListener(SAVED_LIBRARY_CHANGED_EVENT, load);
  }, [id]);

  if (list === undefined) return <SavedLibraryLoading />;
  if (!list) {
    return (
      <MissingSavedItem
        description="Personal lists remain only on the device and browser where they were created."
        title="This list is not available in this browser."
      />
    );
  }

  return (
    <main className="personal-reading-list-page">
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <header className="semantic-list-header border-b hairline pb-8">
          <div>
            <p className="filter-label">Private reading list</p>
            <h1 className="mt-4 font-[var(--font-serif)] text-4xl font-light leading-tight sm:text-5xl">{list.title}</h1>
            <p className="mt-4 text-sm leading-6 muted">
              {list.books.length.toLocaleString()} {list.books.length === 1 ? "book" : "books"}
            </p>
          </div>
          <div className="semantic-list-header-actions">
            <PersonalListShareEditor key={`${list.id}-${list.updatedAt}`} list={list} />
            <Link className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" href="/saved">
              Back to Saved
            </Link>
          </div>
        </header>
        {list.books.length ? (
          <ol className="saved-book-index saved-book-list-detail mt-8">
            {list.books.map((book, index) => (
              <li key={book.bookId}>
                <span className="saved-list-rank">{String(index + 1).padStart(2, "0")}</span>
                <Link className="saved-book-cover focus-ring" href={`/books/${book.slug}`}>
                  {book.thumbnailUrl ? <img alt="" src={book.thumbnailUrl} /> : <span>{book.title.slice(0, 1)}</span>}
                </Link>
                <Link className="saved-book-main focus-ring" href={`/books/${book.slug}`}>
                  <strong>{book.title}</strong>
                  <small>{book.authors.join(", ") || "Unknown author"}{book.publicationYear ? ` · ${book.publicationYear}` : ""}</small>
                </Link>
                <button
                  aria-label={`Remove ${book.title} from ${list.title}`}
                  className="saved-list-remove focus-ring"
                  onClick={() => void removeBookFromPersonalList(list.id, book.bookId)}
                  type="button"
                >
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="saved-library-welcome mt-8">
            <List aria-hidden="true" size={22} />
            <div>
              <h2>This list is empty</h2>
              <p>Open a book and use its bookmark control to add it here.</p>
            </div>
            <Link className="personal-reading-list-action focus-ring inline-flex items-center gap-2 px-4 py-2.5 text-sm" href="/books">
              Explore books
              <ArrowRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}

function SavedSection({
  action,
  children,
  count,
  description,
  icon,
  title,
}: {
  action: React.ReactNode;
  children: React.ReactNode;
  count: number;
  description: string;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className="saved-library-section">
      <header>
        <div className="saved-library-section-title">
          <span aria-hidden="true">{icon}</span>
          <div>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
          <span className="saved-library-count">{count.toLocaleString()}</span>
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function SavedMetric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function SavedSectionEmpty({ children }: { children: React.ReactNode }) {
  return <p className="saved-section-empty">{children}</p>;
}

function MissingSavedItem({ description, title }: { description: string; title: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6">
      <p className="filter-label">Saved item unavailable</p>
      <h1 className="mt-4 font-[var(--font-serif)] text-4xl font-light">{title}</h1>
      <p className="mt-5 leading-7 muted">{description}</p>
      <Link className="filter-action focus-ring mt-7 inline-flex px-4 py-2.5 text-sm" href="/saved">Back to Saved</Link>
    </main>
  );
}

function SavedLibraryLoading() {
  return <p className="saved-lists-loading" role="status">Loading saved items…</p>;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(new Date(value));
}
