"use client";

import { useEffect, useState } from "react";

/** Wait for the new section to render before moving focus and the viewport. */
export function useScrollNavigation() {
  const [destination, setDestination] = useState<{
    id: string;
    focusSelector?: string;
  } | null>(null);

  useEffect(() => {
    if (!destination) return;
    const frame = requestAnimationFrame(() => {
      const container = document.getElementById(destination.id);
      if (!container) return;
      const focusTarget = destination.focusSelector
        ? container.querySelector<HTMLElement>(destination.focusSelector)
        : container;
      focusTarget?.focus({ preventScroll: true });
      if (focusTarget instanceof HTMLInputElement) focusTarget.select();
      container.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [destination]);

  return (id: string, focusSelector?: string) =>
    setDestination({ id, focusSelector });
}
