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
        Last updated May 12, 2026
      </p>

      <TextPageSection id="collection" title="Collection">
        <p>
          The Book Prize Index is designed for browsing public book-prize data. If you enter an email address for updates,
          that address may be used to send site news and related notices. Server logs may also record basic technical
          information such as request time, browser, and IP address.
        </p>
      </TextPageSection>

      <TextPageSection id="use" title="Use">
        <p>
          Information is used to operate the site, improve reliability, respond to requests, and send updates if you ask
          for them. The site does not sell personal information.
        </p>
      </TextPageSection>

      <TextPageSection id="third-parties" title="Services">
        <p>
          Semantic search may send the text of your search query to OpenAI to generate an embedding or improve query
          interpretation. The site may also link to external services such as booksellers, libraries, Wikipedia, Open
          Library, Google Books, and award pages; those services have their own privacy practices.
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
