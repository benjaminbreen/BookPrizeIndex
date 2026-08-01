"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Retrieval language preference. "english" (the default) hides works with no
 * English edition; "all" opts into the full catalog including untranslated books.
 */
export type LanguageFilterKey = "english" | "all";

const LANGUAGE_FILTER_STORAGE_KEY = "book-prize-language-filter";

function normalize(value: string | null): LanguageFilterKey {
  return value === "all" ? "all" : "english";
}

export function useLanguageFilter(defaultValue: LanguageFilterKey = "english") {
  const [language, setLanguageState] = useState<LanguageFilterKey>(defaultValue);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(LANGUAGE_FILTER_STORAGE_KEY);
      if (stored) setLanguageState(normalize(stored));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, []);

  const setLanguage = useCallback((next: LanguageFilterKey) => {
    setLanguageState(next);
    try {
      localStorage.setItem(LANGUAGE_FILTER_STORAGE_KEY, next);
    } catch {
      // The filter still works for the current page when storage is unavailable.
    }
  }, []);

  return [language, setLanguage] as const;
}

export function languageFilterLabel(value: LanguageFilterKey) {
  return value === "english" ? "Available in English" : "All languages";
}
