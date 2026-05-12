import { PublisherBrowser } from "@/components/publisher-browser";

export const metadata = {
  title: "Publishers / The Book Prize Index",
};

export default async function PublishersPage() {
  return <PublisherBrowser defaultRegion="all" />;
}
