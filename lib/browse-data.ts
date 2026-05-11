import rawBrowseData from "@/data/public/browse.json";
import type { BrowseData } from "@/lib/browse-types";

export const browseData = rawBrowseData as unknown as BrowseData;
