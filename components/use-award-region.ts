"use client";

import { useCallback, useEffect, useState } from "react";
import { normalizeAwardRegion, type AwardRegionFilter } from "@/lib/award-region";

const AWARD_REGION_STORAGE_KEY = "book-prize-award-region";

export function useAwardRegion(defaultRegion: AwardRegionFilter) {
  const [region, setRegionState] = useState<AwardRegionFilter>(defaultRegion);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AWARD_REGION_STORAGE_KEY);
      if (stored) setRegionState(normalizeAwardRegion(stored));
    } catch {
      // Storage can be unavailable in privacy-restricted browser contexts.
    }
  }, []);

  const setRegion = useCallback((nextRegion: AwardRegionFilter) => {
    setRegionState(nextRegion);
    try {
      localStorage.setItem(AWARD_REGION_STORAGE_KEY, nextRegion);
    } catch {
      // The filter still works for the current page when storage is unavailable.
    }
  }, []);

  return [region, setRegion] as const;
}
