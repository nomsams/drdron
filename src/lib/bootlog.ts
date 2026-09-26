// Boot-stage logging. The #boot splash in index.html is plain HTML with an
// inline script that installs window.__flyjsLog BEFORE any module loads, so
// even a total module-graph crash still leaves a visible log. These helpers
// mirror every line to the devtools console too.

interface BootWindow extends Window {
  __flyjsLog?: (msg: string) => void;
  __flyjsBootStatus?: (s: string) => void;
  __flyjsBootDone?: () => void;
}

function hooks(): BootWindow {
  return window as BootWindow;
}

/** Timestamped line into the splash log (survives React crashes). */
export function blog(msg: string): void {
  try {
    hooks().__flyjsLog?.(msg);
  } catch {
    /* splash already gone */
  }
  console.log(`[flyjs] ${msg}`);
}

/** Error + stack into the splash log and the console. */
export function blogErr(err: unknown, where = ""): void {
  const msg =
    err instanceof Error
      ? err.stack || `${err.name}: ${err.message}`
      : String(err);
  try {
    hooks().__flyjsLog?.(`ERROR${where ? ` [${where}]` : ""}: ${msg}`);
  } catch {
    /* splash already gone */
  }
  console.error(`[flyjs]${where ? ` [${where}]` : ""}`, err);
}

/** Swap the spinner text (mounting, loading 3D, …). */
export function bootStatus(s: string): void {
  try {
    hooks().__flyjsBootStatus?.(s);
  } catch {
    /* ignore */
  }
}

/** Remove the splash. Falls back to direct DOM removal. */
export function bootDone(): void {
  try {
    const fn = hooks().__flyjsBootDone;
    if (typeof fn === "function") {
      fn();
      return;
    }
  } catch {
    /* fall through */
  }
  document.getElementById("boot")?.remove();
}
