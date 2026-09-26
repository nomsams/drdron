import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { blog, blogErr, bootDone, bootStatus } from "./lib/bootlog";
import App from "./App";
import ErrorBoundary from "./ui/ErrorBoundary";
import "./index.css";

blog("main.tsx executing");

function RemoveBootSplash() {
  useEffect(() => {
    blog("React mounted — removing splash");
    bootDone();
  }, []);
  return null;
}

try {
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("#root element missing from index.html");
  bootStatus("mounting React…");
  blog("creating root + render()");
  createRoot(rootEl).render(
    <StrictMode>
      <ErrorBoundary>
        <RemoveBootSplash />
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
  blog("render() called (effects pending)");
} catch (err) {
  // Synchronous mount failure (nothing else will run) — leave the splash up
  // with the error visible in its log.
  blogErr(err, "mount");
  bootStatus("failed to start — see log below");
}
