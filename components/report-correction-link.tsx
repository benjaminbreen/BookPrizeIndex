import { CONTACT_EMAIL } from "@/lib/support-links";
import { getSiteUrl } from "@/lib/site";

export function ReportCorrectionLink({
  path,
  recordId,
  recordTitle,
  recordType,
}: {
  path: string;
  recordId: string;
  recordTitle: string;
  recordType: "award" | "award program" | "book";
}) {
  const recordUrl = new URL(path, getSiteUrl()).toString();
  const params = new URLSearchParams({
    subject: `Book Prize Index correction: ${recordTitle}`,
    body: [
      `Record: ${recordTitle}`,
      `Type: ${recordType}`,
      `ID: ${recordId}`,
      `URL: ${recordUrl}`,
      "",
      "Suggested correction:",
      "",
      "Source URL:",
      "",
      "Notes:",
    ].join("\n"),
  });

  return (
    <a
      className="focus-ring inline-flex items-center border hairline px-3 py-2 font-[var(--font-mono)] text-[0.66rem] uppercase tracking-[0.12em] transition hover:bg-[var(--accent-soft)]"
      href={`mailto:${CONTACT_EMAIL}?${params.toString()}`}
    >
      Report a correction
    </a>
  );
}
