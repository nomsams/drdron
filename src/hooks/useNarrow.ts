"use client";

import { useEffect, useState } from "react";

// True on phone-width viewports. Used to shrink the minimap, wrap the HUD
// button bar and shorten the controls legend — CSS media queries can't reach
// the inline-styled overlay, so components read this hook instead.

export function useNarrow(breakpoint = 640): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth < breakpoint
  );
  useEffect(() => {
    try {
      const mq = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
      const onChange = () => setNarrow(mq.matches);
      onChange();
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    } catch {
      return;
    }
  }, [breakpoint]);
  return narrow;
}
