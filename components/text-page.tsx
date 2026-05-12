type TextPageItem = {
  href: string;
  label: string;
};

export function TextPageShell({
  children,
  label,
  navItems,
}: {
  children: React.ReactNode;
  label: string;
  navItems: TextPageItem[];
}) {
  return (
    <main className="text-page mx-auto grid max-w-[58rem] gap-8 px-4 py-12 sm:px-6 md:grid-cols-[10rem_minmax(0,36rem)] md:gap-16 md:py-20 lg:px-8">
      <nav className="border-b hairline pb-4 font-[var(--font-mono)] text-[0.68rem] uppercase leading-7 tracking-[0.14em] muted md:sticky md:top-28 md:self-start md:border-b-0 md:pb-0">
        <p className="mb-3 text-[var(--ink)]">{label}</p>
        <ol className="grid grid-cols-2 gap-x-5 md:block">
          {navItems.map((item) => (
            <li key={item.href}>
              <a className="transition hover:text-[var(--ink)]" href={item.href}>{item.label}</a>
            </li>
          ))}
        </ol>
      </nav>
      <article>{children}</article>
    </main>
  );
}

export function TextPageTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="font-[var(--font-serif)] text-4xl font-light leading-tight tracking-[-0.02em] sm:text-5xl">
      {children}
    </h1>
  );
}

export function TextPageSection({
  children,
  id,
  title,
}: {
  children: React.ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section className="mt-10 scroll-mt-24 border-t hairline pt-5 first:mt-8" id={id}>
      <h2 className="font-[var(--font-mono)] text-[0.68rem] font-normal uppercase tracking-[0.16em]">{title}</h2>
      <div className="mt-4 space-y-5 text-lg leading-9 muted">{children}</div>
    </section>
  );
}
