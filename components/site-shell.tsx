"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, Moon, Sun, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const DONATE_URL = "https://buy.stripe.com/5kQaEXfJLgRGbqrf1L4F201";
const NEWSLETTER_URL = "https://resobscura.substack.com/subscribe?";

const navItems = [
  { href: "/books", label: "Books", match: ["/books"] },
  { href: "/awards", label: "Awards", match: ["/awards"] },
  { href: "/subjects", label: "Subjects", match: ["/subjects", "/topics"] },
  { href: "/fun/library-of-congress-shelf", label: "Shelf", match: ["/fun/library-of-congress-shelf"] },
  { href: "/publishers", label: "Publishers", match: ["/publishers", "/imprints", "/imprint-logos"] },
  { href: "/experiments", label: "Trends", match: ["/experiments"] },
  { href: DONATE_URL, label: "Donate", match: [] },
];

const primaryNavItems = navItems.slice(0, 3);
const overflowNavItems = navItems.slice(3);

export function SiteShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const breadcrumbs = useMemo(() => getBreadcrumbs(pathname), [pathname]);
  const immersive = pathname === "/fun/chromatic-index";

  useEffect(() => {
    const stored = localStorage.getItem("book-prize-theme");
    const shouldDark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", shouldDark);
    setDark(shouldDark);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [moreOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [menuOpen]);

  function toggleTheme() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("book-prize-theme", next ? "dark" : "light");
    setDark(next);
  }

  return (
    <div className="min-h-screen">
      <header className="site-header sticky top-0 z-20 border-b hairline backdrop-blur">
        <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_auto] items-center gap-8 px-4 sm:px-6 lg:px-8">
          <Link className="nav-mark font-[var(--font-mono)] text-md font-medium uppercase tracking-[0.2em]" href="/">
            The Book Prize Index
          </Link>
          <nav className="hidden items-center justify-end gap-4 text-sm lg:flex xl:hidden">
            {primaryNavItems.map((item) => {
              const active = item.match.some((href) => pathname === href || pathname.startsWith(`${href}/`));
              return (
                <Link aria-current={active ? "page" : undefined} className={`nav-link ${active ? "nav-link-active" : ""}`} href={item.href} key={item.href}>
                  {item.label}
                </Link>
              );
            })}
            <div className="header-more-menu">
              <button
                aria-controls="header-more-links"
                aria-expanded={moreOpen}
                className={`nav-link focus-ring inline-flex items-center gap-1 ${overflowNavItems.some((item) => item.match.some((href) => pathname === href || pathname.startsWith(`${href}/`))) ? "nav-link-active" : ""}`}
                onClick={() => setMoreOpen((open) => !open)}
                type="button"
              >
                More
                <ChevronDown aria-hidden="true" className={moreOpen ? "rotate-180" : ""} size={13} />
              </button>
              {moreOpen ? (
                <div className="header-more-popover" id="header-more-links">
                  {overflowNavItems.map((item) => {
                    const active = item.match.some((href) => pathname === href || pathname.startsWith(`${href}/`));
                    return (
                      <Link aria-current={active ? "page" : undefined} className={active ? "header-more-link header-more-link-active" : "header-more-link"} href={item.href} key={item.href}>
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </nav>
          <nav className="hidden items-center justify-end gap-4 text-sm xl:flex xl:gap-7">
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
            type="button"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            aria-controls="mobile-site-menu"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            className={`mobile-menu-button focus-ring grid h-10 w-10 place-items-center border hairline lg:hidden ${menuOpen ? "mobile-menu-button-open" : ""}`}
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <Menu className="mobile-menu-icon mobile-menu-icon-menu" size={18} />
            <X className="mobile-menu-icon mobile-menu-icon-close" size={18} />
          </button>
        </div>
        {!immersive && breadcrumbs.length > 1 ? (
          <div className="breadcrumb-bar border-t hairline">
            <nav aria-label="Breadcrumb" className="mx-auto flex h-12 max-w-7xl items-center gap-4 overflow-x-auto px-4 text-sm muted sm:px-6 lg:px-8">
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
        <div aria-hidden={!menuOpen} className={`mobile-menu-shell lg:hidden ${menuOpen ? "mobile-menu-shell-open" : ""}`} id="mobile-site-menu">
          <div className="mobile-menu-panel border-t hairline bg-[color-mix(in_srgb,var(--paper)_96%,var(--panel))] shadow-[0_24px_60px_color-mix(in_srgb,var(--ink)_13%,transparent)]">
            <nav aria-label="Mobile navigation" className="mx-auto grid max-w-7xl px-4 py-3">
              {navItems.map((item) => {
                const active = item.match.some((href) => pathname === href || pathname.startsWith(`${href}/`));
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={`mobile-nav-link focus-ring ${active ? "mobile-nav-link-active" : ""}`}
                    href={item.href}
                    key={item.href}
                    tabIndex={menuOpen ? undefined : -1}
                  >
                    <span>{item.label}</span>
                    <span aria-hidden="true">{String(navItems.indexOf(item) + 1).padStart(2, "0")}</span>
                  </Link>
                );
              })}
            </nav>
            <div className="mx-auto flex max-w-7xl flex-wrap gap-2 border-t hairline px-4 py-3 font-[var(--font-mono)] text-xs uppercase tracking-[0.14em] muted">
              <Link className="mobile-menu-secondary focus-ring" href="/topics" tabIndex={menuOpen ? undefined : -1}>Topics</Link>
              <Link className="mobile-menu-secondary focus-ring" href="/imprints" tabIndex={menuOpen ? undefined : -1}>Imprints</Link>
              <Link className="mobile-menu-secondary focus-ring" href="/about" tabIndex={menuOpen ? undefined : -1}>About</Link>
            </div>
          </div>
        </div>
      </header>
      {children}
      {!immersive ? <SiteFooter /> : null}
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
  if (part === "experiments") return "Trends";
  if (part === "fun") return "For Fun";
  if (part === "data") return "Data & API";
  if (part === "methodology") return "Methodology";
  if (part === "colophon") return "Colophon";
  if (part === "privacy") return "Privacy";
  if (part === "terms") return "Terms";
  if (part === "accessibility") return "Accessibility";
  return titleFromSlug(part);
}

function titleFromSlug(slug: string) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => {
      if (/^(and|or|of|the|a|an|in|to|for|with)$/.test(part)) return part;
      return part.slice(0, 1).toUpperCase() + part.slice(1);
    })
    .join(" ");
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
            { href: "/data", label: "Data & API" },
            { href: "/fun", label: "For fun" },
            { href: "/methodology", label: "Methodology" },
            { href: "https://github.com/benjaminbreen/BookPrizeIndex", label: "Source code" },
          ]}
        />

        <div>
          <p className="font-[var(--font-mono)] text-xs uppercase tracking-[0.18em]">Support the project</p>
          <p className="mt-5 max-w-xs text-sm leading-7 muted">
            The index is free to use. Help offset its API and hosting costs, or support related research and writing by
            subscribing to Res Obscura.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Link
              aria-label="Donate via Stripe"
              className="focus-ring inline-flex bg-[var(--ink)] px-4 py-3 text-sm text-[var(--paper)] transition hover:bg-[var(--accent)]"
              href={DONATE_URL}
            >
              Donate
            </Link>
            <Link
              aria-label="Subscribe to Res Obscura on Substack"
              className="focus-ring inline-flex border hairline px-4 py-3 text-sm transition hover:bg-[var(--panel)]"
              href={NEWSLETTER_URL}
            >
              Subscribe to Res Obscura
            </Link>
          </div>
          <p className="mt-4 text-xs leading-5 muted">Payments and subscriptions are handled on Stripe and Substack.</p>
        </div>
      </div>
      <div className="bg-[#181713] text-[#f4f1ea]">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 font-[var(--font-mono)] text-xs sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <p>© 2026 The Book Prize Index</p>
          <nav className="flex flex-wrap items-center gap-4 text-[#c9c1b3]">
            <Link className="transition hover:text-[#f4f1ea]" href="/privacy">Privacy</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="/terms">Terms</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="/accessibility">Accessibility</Link>
            <span>|</span>
            <Link className="transition hover:text-[#f4f1ea]" href="/colophon">Colophon</Link>
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
