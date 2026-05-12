"use client";

import { useEffect, useMemo, useState } from "react";
import type { SemanticQueryInterpretation, SemanticSearchResult } from "@/lib/semantic-search";

export type SemanticBookSearchState = {
  diagnostics: SemanticSearchDiagnostics | null;
  error: string | null;
  interpretation: SemanticQueryInterpretation | null;
  loading: boolean;
  query: string | null;
  results: SemanticSearchResult[];
  warning?: string;
};

export type SemanticSearchDiagnostics = {
  candidateBookCount?: number;
  embeddingInput?: string;
  embeddingModel?: string;
  indexBookCount?: number;
  indexGeneratedAt?: string;
  interpretationModel?: string;
  rankingTerms?: string[];
  resultCount?: number;
  usedModelInterpretation?: boolean;
};

export function useSemanticBookSearch({
  candidateBookIds,
  enabled,
  limit = 250,
  query,
}: {
  candidateBookIds: string[];
  enabled: boolean;
  limit?: number;
  query: string;
}) {
  const [state, setState] = useState<SemanticBookSearchState>({
    diagnostics: null,
    error: null,
    interpretation: null,
    loading: false,
    query: null,
    results: [],
  });
  const candidateKey = useMemo(() => candidateBookIds.join("|"), [candidateBookIds]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 3) {
      setState({ diagnostics: null, error: null, interpretation: null, loading: false, query: null, results: [] });
      return;
    }

    const controller = new AbortController();
    setState({ diagnostics: null, error: null, interpretation: null, loading: true, query: trimmed, results: [] });
    const timeout = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/search/semantic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateBookIds, limit, query: trimmed }),
          signal: controller.signal,
        });
        const json = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(typeof json.error === "string" ? json.error : `Semantic search failed (${response.status}).`);
        }
        setState({
          diagnostics: json.diagnostics ?? null,
          error: null,
          interpretation: json.interpretation ?? null,
          loading: false,
          query: typeof json.query === "string" ? json.query : trimmed,
          results: Array.isArray(json.results) ? json.results : [],
          warning: json.warning,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        setState({
          diagnostics: null,
          error: error instanceof Error ? error.message : "Semantic search failed.",
          interpretation: null,
          loading: false,
          query: trimmed,
          results: [],
        });
      }
    }, 320);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [candidateBookIds, candidateKey, enabled, limit, query]);

  return state;
}
