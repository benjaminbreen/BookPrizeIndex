"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ImprintKeyboardNav({ nextHref, previousHref }: { nextHref?: string; previousHref?: string }) {
  const router = useRouter();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (isTextEntry(event.target)) return;

      if (event.key === "ArrowLeft" && previousHref) {
        event.preventDefault();
        router.push(previousHref);
      }

      if (event.key === "ArrowRight" && nextHref) {
        event.preventDefault();
        router.push(nextHref);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [nextHref, previousHref, router]);

  return null;
}

function isTextEntry(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
