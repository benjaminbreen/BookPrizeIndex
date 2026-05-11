import { PublisherBrowser } from "@/components/publisher-browser";
import { AWARD_REGION_COOKIE, normalizeAwardRegion } from "@/lib/award-region";
import { cookies } from "next/headers";

export const metadata = {
  title: "Publishers / The Book Prize Index",
};

export default async function PublishersPage() {
  const defaultRegion = normalizeAwardRegion((await cookies()).get(AWARD_REGION_COOKIE)?.value);
  return <PublisherBrowser defaultRegion={defaultRegion} />;
}
