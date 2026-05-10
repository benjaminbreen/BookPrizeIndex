import { ExplorerHome } from "@/components/explorer-home";
import { data } from "@/lib/data";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { cookies } from "next/headers";
import { Suspense } from "react";

export default async function Home() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);

  return (
    <Suspense fallback={null}>
      <ExplorerHome data={data} defaultRegion={defaultRegion} />
    </Suspense>
  );
}
