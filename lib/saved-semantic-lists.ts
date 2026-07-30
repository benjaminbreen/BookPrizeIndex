"use client";

import type { SemanticListSnapshot } from "@/lib/semantic-list";
import type {
  PersonalBookList,
  SavedBook,
  SavedBookInput,
  SavedLibraryCounts,
} from "@/lib/saved-library-types";

const DATABASE_NAME = "book-prize-saved-lists";
const SEARCH_LIST_STORE = "lists";
const BOOK_STORE = "books";
const PERSONAL_LIST_STORE = "personal-lists";
const DATABASE_VERSION = 2;
export const SAVED_LIBRARY_CHANGED_EVENT = "book-prize-saved-library-changed";
export const SAVED_LISTS_CHANGED_EVENT = SAVED_LIBRARY_CHANGED_EVENT;

export type SavedSemanticListSummary = Pick<
  SemanticListSnapshot,
  "createdAt" | "id" | "query" | "title" | "version"
> & {
  resultCount: number;
  savedAt: string;
};

type StoredSemanticList = {
  savedAt: string;
  snapshot: SemanticListSnapshot;
};

export async function saveSemanticList(snapshot: SemanticListSnapshot) {
  const database = await openDatabase();
  const stored: StoredSemanticList = { savedAt: new Date().toISOString(), snapshot };
  await transactionPromise(database, SEARCH_LIST_STORE, "readwrite", (store) => store.put(stored, snapshot.id));
  database.close();
  notifySavedLibraryChanged("add");
  return stored;
}

export async function getSavedSemanticList(id: string) {
  const database = await openDatabase();
  const stored = await requestPromise<StoredSemanticList | undefined>(
    database.transaction(SEARCH_LIST_STORE, "readonly").objectStore(SEARCH_LIST_STORE).get(id),
  );
  database.close();
  return stored ?? null;
}

export async function listSavedSemanticLists(): Promise<SavedSemanticListSummary[]> {
  const database = await openDatabase();
  const records = await requestPromise<StoredSemanticList[]>(
    database.transaction(SEARCH_LIST_STORE, "readonly").objectStore(SEARCH_LIST_STORE).getAll(),
  );
  database.close();
  return records
    .map(({ savedAt, snapshot }) => ({
      createdAt: snapshot.createdAt,
      id: snapshot.id,
      query: snapshot.query,
      resultCount: snapshot.results.length,
      savedAt,
      title: snapshot.title,
      version: snapshot.version,
    }))
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function removeSavedSemanticList(id: string) {
  const database = await openDatabase();
  await transactionPromise(database, SEARCH_LIST_STORE, "readwrite", (store) => store.delete(id));
  database.close();
  notifySavedLibraryChanged("remove");
}

export async function isSemanticListSaved(id: string) {
  const database = await openDatabase();
  const key = await requestPromise<IDBValidKey | undefined>(
    database.transaction(SEARCH_LIST_STORE, "readonly").objectStore(SEARCH_LIST_STORE).getKey(id),
  );
  database.close();
  return key !== undefined;
}

export async function saveBook(book: SavedBookInput) {
  const database = await openDatabase();
  const existing = await getRecord<SavedBook>(database, BOOK_STORE, book.bookId);
  const stored: SavedBook = {
    ...book,
    savedAt: existing?.savedAt ?? new Date().toISOString(),
  };
  await transactionPromise(database, BOOK_STORE, "readwrite", (store) => store.put(stored, book.bookId));
  database.close();
  notifySavedLibraryChanged("add");
  return stored;
}

export async function removeSavedBook(bookId: string) {
  const database = await openDatabase();
  await transactionPromise(database, BOOK_STORE, "readwrite", (store) => store.delete(bookId));
  database.close();
  notifySavedLibraryChanged("remove");
}

export async function isBookSaved(bookId: string) {
  const database = await openDatabase();
  const key = await requestPromise<IDBValidKey | undefined>(
    database.transaction(BOOK_STORE, "readonly").objectStore(BOOK_STORE).getKey(bookId),
  );
  database.close();
  return key !== undefined;
}

export async function listSavedBooks() {
  const database = await openDatabase();
  const books = await getAllRecords<SavedBook>(database, BOOK_STORE);
  database.close();
  return books.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}

export async function createPersonalBookList(title: string, initialBook?: SavedBookInput) {
  const normalizedTitle = normalizeListTitle(title);
  const now = new Date().toISOString();
  const list: PersonalBookList = {
    books: initialBook ? [{ ...initialBook, savedAt: now }] : [],
    createdAt: now,
    id: createPersonalListId(),
    title: normalizedTitle,
    updatedAt: now,
  };
  const database = await openDatabase();
  await transactionPromise(database, PERSONAL_LIST_STORE, "readwrite", (store) => store.put(list, list.id));
  database.close();
  notifySavedLibraryChanged("add");
  return list;
}

export async function getPersonalBookList(id: string) {
  const database = await openDatabase();
  const list = await getRecord<PersonalBookList>(database, PERSONAL_LIST_STORE, id);
  database.close();
  return list ?? null;
}

export async function listPersonalBookLists() {
  const database = await openDatabase();
  const lists = await getAllRecords<PersonalBookList>(database, PERSONAL_LIST_STORE);
  database.close();
  return lists.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function addBookToPersonalList(listId: string, book: SavedBookInput) {
  const database = await openDatabase();
  const list = await getRecord<PersonalBookList>(database, PERSONAL_LIST_STORE, listId);
  if (!list) {
    database.close();
    throw new Error("That list is no longer available.");
  }
  const now = new Date().toISOString();
  const existing = list.books.find((candidate) => candidate.bookId === book.bookId);
  const next: PersonalBookList = {
    ...list,
    books: existing
      ? list.books.map((candidate) => candidate.bookId === book.bookId ? { ...book, savedAt: candidate.savedAt } : candidate)
      : [...list.books, { ...book, savedAt: now }],
    updatedAt: now,
  };
  await transactionPromise(database, PERSONAL_LIST_STORE, "readwrite", (store) => store.put(next, next.id));
  database.close();
  notifySavedLibraryChanged("add");
  return next;
}

export async function removeBookFromPersonalList(listId: string, bookId: string) {
  const database = await openDatabase();
  const list = await getRecord<PersonalBookList>(database, PERSONAL_LIST_STORE, listId);
  if (!list) {
    database.close();
    return null;
  }
  const next: PersonalBookList = {
    ...list,
    books: list.books.filter((book) => book.bookId !== bookId),
    updatedAt: new Date().toISOString(),
  };
  await transactionPromise(database, PERSONAL_LIST_STORE, "readwrite", (store) => store.put(next, next.id));
  database.close();
  notifySavedLibraryChanged("remove");
  return next;
}

export async function removePersonalBookList(id: string) {
  const database = await openDatabase();
  await transactionPromise(database, PERSONAL_LIST_STORE, "readwrite", (store) => store.delete(id));
  database.close();
  notifySavedLibraryChanged("remove");
}

export async function getSavedLibraryCounts(): Promise<SavedLibraryCounts> {
  const database = await openDatabase();
  const [books, personalLists, searchLists] = await Promise.all([
    countRecords(database, BOOK_STORE),
    countRecords(database, PERSONAL_LIST_STORE),
    countRecords(database, SEARCH_LIST_STORE),
  ]);
  database.close();
  return {
    books,
    personalLists,
    searchLists,
    total: books + personalLists + searchLists,
  };
}

function openDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Saved items are not supported by this browser."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEARCH_LIST_STORE)) database.createObjectStore(SEARCH_LIST_STORE);
      if (!database.objectStoreNames.contains(BOOK_STORE)) database.createObjectStore(BOOK_STORE);
      if (!database.objectStoreNames.contains(PERSONAL_LIST_STORE)) database.createObjectStore(PERSONAL_LIST_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open saved-item storage."));
  });
}

function transactionPromise(
  database: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest,
) {
  return new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    operation(transaction.objectStore(storeName));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Could not update saved items."));
    transaction.onabort = () => reject(transaction.error ?? new Error("The saved-item update was cancelled."));
  });
}

function getRecord<T>(database: IDBDatabase, storeName: string, key: IDBValidKey) {
  return requestPromise<T | undefined>(
    database.transaction(storeName, "readonly").objectStore(storeName).get(key),
  );
}

function getAllRecords<T>(database: IDBDatabase, storeName: string) {
  return requestPromise<T[]>(
    database.transaction(storeName, "readonly").objectStore(storeName).getAll(),
  );
}

function countRecords(database: IDBDatabase, storeName: string) {
  return requestPromise<number>(
    database.transaction(storeName, "readonly").objectStore(storeName).count(),
  );
}

function requestPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not read saved items."));
  });
}

function normalizeListTitle(title: string) {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("Give the list a name.");
  return normalized.slice(0, 80);
}

function createPersonalListId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function notifySavedLibraryChanged(action: "add" | "remove" | "update") {
  window.dispatchEvent(new CustomEvent(SAVED_LIBRARY_CHANGED_EVENT, { detail: { action } }));
}
