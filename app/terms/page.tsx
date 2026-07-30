import { TextPageSection, TextPageShell, TextPageTitle } from "@/components/text-page";

export const metadata = {
  title: "Terms / The Book Prize Index",
  description: "Terms for using The Book Prize Index website, data, and API.",
  alternates: { canonical: "/terms" },
};

const navItems = [
  { href: "#use", label: "Use" },
  { href: "#data", label: "Data" },
  { href: "#support", label: "Support" },
  { href: "#links", label: "Links" },
  { href: "#changes", label: "Changes" },
];

export default function TermsPage() {
  return (
    <TextPageShell label="Terms" navItems={navItems}>
      <TextPageTitle>Terms</TextPageTitle>
      <p className="mt-5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">
        Last updated July 30, 2026
      </p>

      <TextPageSection id="use" title="Use">
        <p>
          The Book Prize Index is provided as a free public reference. You may use it for reading, research, discovery,
          citation checking, and analysis, provided you do not interfere with the service or misuse the site. Reuse of
          the downloadable dataset is governed by the license stated on the Data &amp; API page.
        </p>
        <p>
          Stable shared-list links publish their submitted contents to anyone with the link. For Meaning searches this
          includes the search phrase and generated interpretation; for personal reading lists it includes the submitted
          creator display name, edited title, optional introduction, selected books, and order. Do not use shared lists
          to publish unlawful, abusive, invasive, or misleading material, impersonate another person, or imply that a
          named person participated in or endorsed an AI-assisted list.
        </p>
      </TextPageSection>

      <TextPageSection id="data" title="Data">
        <p>
          The catalog is assembled from public award records, source links, enrichment data, and editorial curation. It is
          offered as-is and may contain gaps, provisional assignments, or errors. Please verify important claims against
          primary sources. The CC BY 4.0 license for the downloadable core dataset does not cover third-party cover images,
          logos, summaries, or other material identified as having separate rights.
        </p>
      </TextPageSection>

      <TextPageSection id="support" title="Support">
        <p>
          Donations are optional, are processed by Stripe on its own checkout page, and do not purchase access, services,
          influence over the index, or any ownership interest. Newsletter subscriptions are handled separately by Res
          Obscura on Substack and are governed by Substack&apos;s and Res Obscura&apos;s applicable terms.
        </p>
      </TextPageSection>

      <TextPageSection id="links" title="Links">
        <p>
          The site links to external award pages, publishers, libraries, booksellers, reference services, Stripe, and
          Substack. Those sites are independent and are responsible for their own content, policies, and availability.
        </p>
      </TextPageSection>

      <TextPageSection id="changes" title="Changes">
        <p>
          These terms may be updated as the project changes. Continued use of the site after an update means you accept
          the revised terms.
        </p>
      </TextPageSection>
    </TextPageShell>
  );
}
