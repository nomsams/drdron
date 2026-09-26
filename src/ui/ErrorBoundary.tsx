"use client";

import { Component, type ReactNode } from "react";

// Catches render/3D crashes (e.g. WebGL unavailable) and shows a readable
// message instead of a blank page.

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[flyjs]", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#0c1324",
            color: "#e8eaf6",
            fontFamily: "system-ui, sans-serif",
            padding: 24,
            textAlign: "center",
          }}
        >
          <div>
            <h1 style={{ fontSize: 20 }}>Something broke in the 3D view</h1>
            <p style={{ opacity: 0.7, fontSize: 14, maxWidth: 460 }}>
              {this.state.error.message || "Unknown error"} — try a browser with WebGL enabled,
              or <code>?quality=potato</code> on weak hardware.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{ padding: "10px 20px", borderRadius: 10, border: "none", cursor: "pointer", fontWeight: 700 }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
