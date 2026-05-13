import { PublisherBrowser } from "@/components/publisher-browser";
import { normalizeAwardRegion } from "@/lib/award-region";

export const metadata = {
  title: "Publishers / The Book Prize Index",
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PublishersPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const view = stringParam(params.view) === "publishers" ? "publishers" : "imprints";
  const period = stringParam(params.period) === "all" ? "all" : "recent";
  const sort = normalizeSort(stringParam(params.sort), view);
  const letter = normalizeLetter(stringParam(params.letter));
  const region = normalizeAwardRegion(stringParam(params.awards) ?? "all");
  return <PublisherBrowser analysisView={view} letter={letter} region={region} sortKey={sort} timeWindow={period} />;
}

function stringParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeLetter(value: string | undefined) {
  if (!value) return null;
  const normalized = value.toUpperCase();
  return /^[A-Z]$/.test(normalized) || normalized === "#" ? normalized : null;
}

function normalizeSort(value: string | undefined, view: "publishers" | "imprints") {
  if (value === "all_activity" || value === "name" || value === "major_activity") return value;
  if (view === "publishers" && value === "imprints") return value;
  return "major_activity";
}
