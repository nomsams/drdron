import { StrictMode, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import ErrorBoundary from "./ui/ErrorBoundary";
import "./index.css";

function RemoveBootSplash() {
  useEffect(() => {
    document.getElementById("boot")?.remove();
  }, []);
  return null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <RemoveBootSplash />
      <App />
    </ErrorBoundary>
  </StrictMode>
);
