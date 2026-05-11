import { ExplorerHome } from "@/components/explorer-home";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { browseData } from "@/lib/browse-data";
import { cookies } from "next/headers";
import { Suspense } from "react";

export default async function Home() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);

  return (
    <Suspense fallback={null}>
      <ExplorerHome data={browseData} defaultRegion={defaultRegion} />
    </Suspense>
  );
}
