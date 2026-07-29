"use client";

import { ArrowUpRight, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { DONATE_URL, NEWSLETTER_URL } from "@/lib/support-links";
import { recordDistinctBookView, SUPPORT_PROMPT_BOOK_THRESHOLD } from "@/lib/support-prompt-session";

type SupportPromptContextValue = {
  recordBookView: (bookIdOrSlug: string) => void;
};

const SupportPromptContext = createContext<SupportPromptContextValue>({
  recordBookView: () => undefined,
});

export function SupportPromptProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const viewedBooksRef = useRef(new Set<string>());
  const promptedRef = useRef(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const closePrompt = useCallback(() => setPromptOpen(false), []);

  const recordBookView = useCallback((bookIdOrSlug: string) => {
    const result = recordDistinctBookView(viewedBooksRef.current, bookIdOrSlug);
    if (!result.added || result.count < SUPPORT_PROMPT_BOOK_THRESHOLD || promptedRef.current) return;

    promptedRef.current = true;
    setPromptOpen(true);
  }, []);

  useEffect(() => {
    const match = pathname.match(/^\/books\/([^/]+)$/);
    if (match?.[1]) recordBookView(`book-${decodeURIComponent(match[1])}`);
  }, [pathname, recordBookView]);

  return (
    <SupportPromptContext.Provider value={{ recordBookView }}>
      {children}
      {promptOpen ? <SupportPromptDialog onClose={closePrompt} /> : null}
    </SupportPromptContext.Provider>
  );
}

export function useSupportPrompt() {
  return useContext(SupportPromptContext);
}

function SupportPromptDialog({ onClose }: { onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;

      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hasAttribute("aria-hidden"));
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = originalOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  return (
    <div className="support-prompt-layer fixed inset-0 z-[90] grid place-items-center p-4">
      <button
        aria-label="Continue browsing"
        className="support-prompt-backdrop absolute inset-0"
        onClick={onClose}
        type="button"
      />
      <div
        aria-describedby="support-prompt-description"
        aria-labelledby="support-prompt-title"
        aria-modal="true"
        className="support-prompt-dialog relative w-full max-w-[34rem] border hairline bg-[var(--paper)] shadow-2xl"
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b hairline px-5 py-4 sm:px-6">
          <p className="font-[var(--font-mono)] text-[0.68rem] uppercase tracking-[0.18em] muted">
            Ten books explored
          </p>
          <button
            aria-label="Close support message"
            className="focus-ring grid h-9 w-9 place-items-center border hairline transition hover:bg-[var(--panel)]"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="px-5 py-6 sm:px-6 sm:py-7">
          <h2 className="max-w-md font-[var(--font-serif)] text-[2rem] font-medium leading-[1.05] sm:text-[2.35rem]" id="support-prompt-title">
            Help keep the index open.
          </h2>
          <p className="mt-4 max-w-lg text-[0.98rem] leading-7 muted" id="support-prompt-description">
            The Book Prize Index is free and independent. If it has been useful, a small donation helps cover hosting,
            search, and data costs. You can also support the research and writing behind it by subscribing to Res Obscura.
          </p>

          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            <a
              className="support-prompt-primary focus-ring inline-flex min-h-12 items-center justify-between gap-3 border px-4 py-3 text-sm"
              href={DONATE_URL}
              onClick={onClose}
              rel="noreferrer"
              target="_blank"
            >
              Donate to the index
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
            <a
              className="focus-ring inline-flex min-h-12 items-center justify-between gap-3 border hairline px-4 py-3 text-sm transition hover:bg-[var(--panel)]"
              href={NEWSLETTER_URL}
              onClick={onClose}
              rel="noreferrer"
              target="_blank"
            >
              Subscribe to Res Obscura
              <ArrowUpRight aria-hidden="true" size={16} />
            </a>
          </div>

          <button
            className="focus-ring mt-5 text-sm underline decoration-[var(--line)] underline-offset-4 transition hover:decoration-[var(--ink)]"
            onClick={onClose}
            type="button"
          >
            Continue browsing
          </button>
          <p className="mt-4 font-[var(--font-mono)] text-[0.65rem] leading-5 uppercase tracking-[0.1em] muted">
            Shown once per page session. No browsing history is stored.
          </p>
        </div>
      </div>
    </div>
  );
}
