import { TextPageSection, TextPageShell, TextPageTitle } from "@/components/text-page";

export const metadata = {
  title: "Privacy / The Book Prize Index",
  description: "Privacy practices for The Book Prize Index.",
  alternates: { canonical: "/privacy" },
};

const navItems = [
  { href: "#collection", label: "Collection" },
  { href: "#catalog-people", label: "Authors" },
  { href: "#use", label: "Use" },
  { href: "#third-parties", label: "Services" },
  { href: "#children", label: "Children" },
];

export default function PrivacyPage() {
  return (
    <TextPageShell label="Privacy" navItems={navItems}>
      <TextPageTitle>Privacy</TextPageTitle>
      <p className="mt-5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">
        Last updated July 29, 2026
      </p>

      <TextPageSection id="collection" title="Collection">
        <p>
          The Book Prize Index has no user accounts, on-site email signup, mailing list, advertising, tracking pixels,
          tracking cookies, or stored search history. Theme and award-region preferences are saved only in your
          browser&apos;s local storage and are never added to a visitor profile or database.
        </p>
        <p>
          The site uses Vercel Web Analytics for anonymous, aggregated page-view statistics. It does not use cookies or
          track visitors across websites or days. Vercel uses a request-derived identifier that resets daily to count
          unique visitors, and analytics records are not associated with an IP address. Page and route, timestamp,
          referrer, approximate location, browser, operating system, and device type may be included. Query strings and
          URL fragments are removed before page-view events are sent, so searches and other URL parameters are not
          included.
        </p>
      </TextPageSection>

      <TextPageSection id="catalog-people" title="Public author information">
        <p>
          To improve book discovery, the catalog may retain a small set of source-backed, professionally relevant facts
          about authors: coarse country connections, living/deceased/unknown status, and links to public writing
          platforms such as Substack. These records come from public reference sources, preserve provenance, and are not
          built from visitor activity.
        </p>
        <p>
          The project does not collect authors&apos; addresses, exact birth dates, contact details, family information,
          follower graphs, reading activity, or inferred sensitive traits such as religion, ethnicity, sexuality,
          health, or political affiliation. Ambiguous matches remain unpublished until reviewed.
        </p>
      </TextPageSection>

      <TextPageSection id="use" title="Use">
        <p>
          The project does not sell, rent, share, or use visitor data for profiling, advertising, or marketing. Search
          queries are not retained by The Book Prize Index or included in its analytics.
        </p>
      </TextPageSection>

      <TextPageSection id="third-parties" title="Services">
        <p>
          Vercel hosts the site and provides the anonymous web analytics described above. Like any hosting provider,
          Vercel necessarily processes requests under its own privacy practices.
        </p>
        <p>
          If you actively submit a Meaning search, the text of that query is sent to OpenAI solely to generate search
          results. The Book Prize Index does not store the query or associate it with an identifier. OpenAI necessarily
          processes the request under its own privacy practices, but this project does not use that service to build
          visitor profiles.
        </p>
        <p>
          Donations are optional and take place on a Stripe-hosted checkout page. Newsletter subscriptions are optional
          and take place on Res Obscura&apos;s Substack page. The Book Prize Index does not receive payment-card details or
          add donors or subscribers to a site account, mailing list, or visitor profile. Stripe may provide the project
          owner with transaction details, and Substack maintains subscription information, under their respective privacy
          practices.
        </p>
        <p>
          Other external links—including libraries, Wikipedia, Open Library, Google Books, publishers, booksellers, and
          award pages—lead to independent services with their own policies.
        </p>
      </TextPageSection>

      <TextPageSection id="children" title="Children">
        <p>
          This site is intended for a general audience and is not directed to children under 13. Please do not submit
          personal information if you are under 13.
        </p>
      </TextPageSection>
    </TextPageShell>
  );
}
