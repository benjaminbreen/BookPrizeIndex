"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { awardsById, data } from "@/lib/data";
import { topicNameForSlug } from "@/lib/topics";

const navItems = [
  { href: "/books", label: "Books", match: ["/books"] },
  { href: "/awards", label: "Awards", match: ["/awards"] },
  { href: "/subjects", label: "Subjects", match: ["/subjects", "/topics"] },
  { href: "/publishers", label: "Publishers", match: ["/publishers", "/imprints", "/imprint-logos"] },
];

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);

  useEffect(() => {
    const stored = localStorage.getItem("book-prize-theme");
    const shouldDark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", shouldDark);
    setDark(shouldDark);
  }, []);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("book-prize-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b hairline bg-[color-mix(in_srgb,var(--paper)_90%,transparent)] backdrop-blur">
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_auto] items-center gap-8 px-4 sm:px-6 lg:px-8">
          <Link className="nav-mark font-[var(--font-mono)] text-md font-medium uppercase tracking-[0.2em]" href="/">
            The Book Prize Index
          </Link>
          <nav className="hidden items-center justify-end gap-7 text-sm md:flex">
            {navItems.map((item) => {
              const active = item.match.some((href) => pathname === href || pathname.startsWith(`${href}/`));
              return (
                <Link aria-current={active ? "page" : undefined} className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href} key={item.href}>
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <button
            className="focus-ring ml-auto grid h-10 w-10 place-items-center border hairline transition hover:bg-[var(--panel)]"
            onClick={toggleTheme}
            aria-label="Toggle dark mode"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
        {breadcrumbs.length > 1 ? (
          <div className="border-t hairline bg-[color-mix(in_srgb,var(--paper)_96%,var(--panel))]">
            <nav className="mx-auto flex h-12 max-w-7xl items-center gap-4 overflow-x-auto px-4 text-sm muted sm:px-6 lg:px-8">
              {breadcrumbs.map((crumb, index) => (
                <span className="flex shrink-0 items-center gap-4" key={crumb.href}>
                  {index > 0 ? <span className="font-[var(--font-mono)] text-xs text-[var(--muted)]">/</span> : null}
                  {index === breadcrumbs.length - 1 ? (
                    <span className="text-[var(--ink)]">{crumb.label}</span>
                  ) : (
                    <Link className="breadcrumb-link transition hover:text-[var(--ink)]" href={crumb.href}>
                      {crumb.label}
                    </Link>
                  )}
                </span>
              ))}
            </nav>
          </div>
        ) : null}
      </header>
      {children}
      <SiteFooter />
    </div>
  );
}

function getBreadcrumbs(pathname: string) {
  const crumbs = [{ href: "/", label: "Index" }];
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return crumbs;

  let href = "";
  for (const part of parts) {
    href += `/${part}`;
    crumbs.push({ href, label: labelForPart(part, href) });
  }
  return crumbs;
}

function labelForPart(part: string, href: string) {
  if (part === "books") return "Books";
  if (part === "awards") return "Awards";
  if (part === "subjects") return "Subjects";
  if (part === "topics") return "Topics";
  if (part === "publishers") return "Publishers";
  if (part === "imprints") return "Imprints";
  const award = data.awards.find((item) => href === `/awards/${item.slug}`);
  if (award) return award.shortName ?? award.name;
  const awardProgram = (data.awardPrograms ?? []).find((item) => href === `/awards/${item.slug}`);
  if (awardProgram) return awardProgram.name;
  const subject = data.subjects.find((item) => href === `/subjects/${item.slug}`);
  if (subject) return subject.name;
  if (href.startsWith("/topics/")) return topicNameForSlug(part) ?? part.replaceAll("-", " ");
  const publisher = data.publishers.find((item) => href === `/publishers/${item.id.replace(/^publisher-/, "")}`);
  if (publisher) return publisher.name;
  const imprint = data.imprints.find((item) => href === `/imprints/${item.id.replace(/^imprint-/, "")}`);
  if (imprint) return imprint.name;
  const book = data.books.find((item) => href === `/books/${item.slug}`);
  if (book) return book.title;
  const mapped = awardsById.get(part);
  return mapped?.shortName ?? part.replaceAll("-", " ");
}

function SiteFooter() {
  return (
    <footer className="footer-band border-t hairline">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-10 sm:px-6 lg:grid-cols-[1.25fr_0.8fr_0.8fr_1.35fr] lg:px-8">
        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">The Book Prize Index</p>
          <p className="mt-5 max-w-xs text-sm leading-7 muted">
            A searchable index of award-winning books, built to make literary prize records open, discoverable, and
            useful to readers, researchers, librarians, and publishers.
          </p>
        </div>

        <FooterColumn
          title="Browse"
          links={[
            { href: "/books", label: "Books" },
            { href: "/awards", label: "Awards" },
            { href: "/subjects", label: "Subjects" },
            { href: "/publishers", label: "Publishers" },
          ]}
        />

        <FooterColumn
          title="Resources"
          links={[
            { href: "/about", label: "About" },
            { href: "#", label: "Methodology" },
            { href: "#", label: "Data Sources" },
            { href: "#", label: "FAQ" },
            { href: "#", label: "Contact" },
          ]}
        />

        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Stay Updated</p>
          <p className="mt-5 max-w-xs text-sm leading-7 muted">Get updates on new data, features, and improvements.</p>
          <form className="mt-5 flex max-w-sm">
            <input
              aria-label="Email address"
              className="min-w-0 flex-1 border hairline bg-transparent px-4 py-3 text-sm outline-none placeholder:text-[var(--muted)] focus:border-[var(--focus)]"
              placeholder="Enter your email"
              type="email"
            />
            <button className="focus-ring bg-[var(--ink)] px-4 py-3 text-sm text-[var(--paper)] transition hover:bg-[var(--accent)]">
              Subscribe
            </button>
          </form>
          <p className="mt-4 text-xs muted">We respect your privacy. Unsubscribe anytime.</p>
        </div>
      </div>
      <div className="bg-[#181713] text-[#f4f1ea]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 font-[var(--font-mono)] text-xs sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>© 2026 The Book Prize Index</p>
          <nav className="flex flex-wrap items-center gap-4 text-[#c9c1b3]">
            <Link className="transition hover:text-[#f4f1ea]" href="#">Privacy</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="#">Terms</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="#">Accessibility</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="#">Colophon</Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">{title}</p>
      <nav className="mt-5 grid gap-3 text-sm muted">
        {links.map((link) => (
          <Link className="transition hover:text-[var(--ink)]" href={link.href} key={link.label}>
            {link.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
