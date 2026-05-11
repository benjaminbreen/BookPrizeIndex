import { AwardsBrowser } from "@/components/awards-browser";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { browseData } from "@/lib/browse-data";
import { cookies } from "next/headers";

export const metadata = {
  title: "Find Awards / The Book Prize Index",
};

export default async function AwardsPage() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);
  return <AwardsBrowser data={browseData} defaultRegion={defaultRegion} />;
}
