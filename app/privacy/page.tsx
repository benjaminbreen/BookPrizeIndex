import { TextPageSection, TextPageShell, TextPageTitle } from "@/components/text-page";

export const metadata = {
  title: "Privacy / The Book Prize Index",
};

const navItems = [
  { href: "#collection", label: "Collection" },
  { href: "#use", label: "Use" },
  { href: "#third-parties", label: "Services" },
  { href: "#children", label: "Children" },
];

export default function PrivacyPage() {
  return (
    <TextPageShell label="Privacy" navItems={navItems}>
      <TextPageTitle>Privacy</TextPageTitle>
      <p className="mt-5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">
        Last updated July 21, 2026
      </p>

      <TextPageSection id="collection" title="Collection">
        <p>
          The Book Prize Index does not collect or store personal data. It has no user accounts, on-site email signup,
          mailing list, analytics, advertising, tracking pixels, tracking cookies, or stored search history. Theme and
          award-region preferences are saved only in your browser&apos;s local storage and are never added to a visitor
          profile or database.
        </p>
      </TextPageSection>

      <TextPageSection id="use" title="Use">
        <p>
          Because the project does not collect personal data, it does not sell, rent, share, or use personal data for
          profiling or marketing. Search and browse activity is not retained by The Book Prize Index.
        </p>
      </TextPageSection>

      <TextPageSection id="third-parties" title="Services">
        <p>
          If you actively submit a Meaning search, the text of that query is sent to OpenAI solely to generate search
          results. The Book Prize Index does not store the query or associate it with an identifier. The hosting provider
          and OpenAI necessarily process requests under their own privacy practices, but this project does not use those
          services to build visitor profiles or retain analytics.
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
