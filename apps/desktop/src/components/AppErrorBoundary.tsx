import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/** Keeps the window usable when a render crash would otherwise leave a blank shell. */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Arrab Studio crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100%",
          display: "grid",
          placeItems: "center",
          padding: 32,
          background: "#17171f",
          color: "#f4f4f5",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 420, display: "grid", gap: 12 }}>
          <p style={{ margin: 0, letterSpacing: "0.18em", fontSize: 11, opacity: 0.55 }}>
            ARRAB STUDIO
          </p>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, opacity: 0.7 }}>
            The window stayed blank after a UI error. Reload to get back into your workspace.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              justifySelf: "center",
              border: 0,
              borderRadius: 999,
              padding: "10px 18px",
              background: "#f4f4f5",
              color: "#111",
              font: "inherit",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload Arrab Studio
          </button>
        </div>
      </div>
    );
  }
}
