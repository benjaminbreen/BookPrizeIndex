import { AwardsBrowser } from "@/components/awards-browser";
import { data } from "@/lib/data";

export const metadata = {
  title: "Find Awards / The Book Prize Index",
};

export default function AwardsPage() {
  return <AwardsBrowser data={data} />;
}
