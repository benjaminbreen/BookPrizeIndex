import { TextPageSection, TextPageShell, TextPageTitle } from "@/components/text-page";

export const metadata = {
  title: "Accessibility / The Book Prize Index",
};

const navItems = [
  { href: "#commitment", label: "Commitment" },
  { href: "#status", label: "Status" },
  { href: "#feedback", label: "Feedback" },
];

export default function AccessibilityPage() {
  return (
    <TextPageShell label="Accessibility" navItems={navItems}>
      <TextPageTitle>Accessibility</TextPageTitle>
      <p className="mt-5 font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.16em] muted">
        Last updated May 12, 2026
      </p>

      <TextPageSection id="commitment" title="Commitment">
        <p>
          The Book Prize Index aims to be usable by readers with a wide range of devices, browsers, input methods, and
          access needs.
        </p>
      </TextPageSection>

      <TextPageSection id="status" title="Status">
        <p>
          The interface is built with semantic HTML, keyboard-accessible controls, visible focus states, responsive
          layouts, and contrast-aware light and dark themes. The working target is WCAG 2.1 Level AA, though the site is
          still evolving.
        </p>
      </TextPageSection>

      <TextPageSection id="feedback" title="Feedback">
        <p>
          If you find an accessibility barrier, please include the page URL, browser or device, and a short description of
          the problem when you get in touch. Accessibility fixes are treated as product bugs.
        </p>
      </TextPageSection>
    </TextPageShell>
  );
}
