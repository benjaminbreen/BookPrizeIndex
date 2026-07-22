"use client";

import { useEffect, useMemo, useState } from "react";
import type { BookCatalogQuery } from "@/lib/book-catalog-query";
import type { SemanticQueryExpansionModel, SemanticQueryInterpretation, SemanticSearchResult } from "@/lib/semantic-search";

type SemanticCandidateFilters = Pick<BookCatalogQuery, "awardId" | "metadata" | "publisherId" | "region" | "subject" | "topic">;

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
  cacheHit?: boolean;
  candidateBookCount?: number;
  embeddingInput?: string;
  embeddingModel?: string;
  indexBookCount?: number;
  indexGeneratedAt?: string;
  interpretationModel?: string;
  rankingTerms?: string[];
  queryExpansionModel?: SemanticQueryExpansionModel;
  resultCount?: number;
  timing?: {
    embeddingMs: number;
    interpretationMs: number;
    rankingMs: number;
    totalMs: number;
  };
  totalMs?: number;
  usedModelInterpretation?: boolean;
};

export function useSemanticBookSearch({
  candidateBookIds,
  enabled,
  filters,
  limit = 250,
  query,
  queryExpansionModel = "gpt-5.4-nano",
}: {
  candidateBookIds: string[];
  enabled: boolean;
  filters?: SemanticCandidateFilters;
  limit?: number;
  query: string;
  queryExpansionModel?: SemanticQueryExpansionModel;
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
  const filtersKey = JSON.stringify(filters ?? {});

  useEffect(() => {
    const trimmed = query.trim();
    if (!enabled || trimmed.length < 3) {
      setState({ diagnostics: null, error: null, interpretation: null, loading: false, query: null, results: [] });
      return;
    }

    const controller = new AbortController();
    setState({ diagnostics: null, error: null, interpretation: null, loading: true, query: trimmed, results: [] });
    void (async () => {
      try {
        const response = await fetch("/api/search/semantic", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateBookIds, filters: JSON.parse(filtersKey), limit, query: trimmed, queryExpansionModel }),
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
    })();

    return () => {
      controller.abort();
    };
  }, [candidateKey, enabled, filtersKey, limit, query, queryExpansionModel]);

  return state;
}
