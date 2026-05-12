import { ExplorerHome } from "@/components/explorer-home";
import { browseData } from "@/lib/browse-data";
import { Suspense } from "react";

export default async function Home() {
  return (
    <Suspense fallback={null}>
      <ExplorerHome data={browseData} defaultRegion="all" />
    </Suspense>
  );
}
