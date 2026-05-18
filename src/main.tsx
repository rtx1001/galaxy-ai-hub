import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

class StartupErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Galaxy startup render error:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100vh",
          background: "#0f1115",
          color: "#e3e3e3",
          display: "grid",
          placeItems: "center",
          padding: 24,
          fontFamily: "Inter, system-ui, sans-serif",
        }}>
          <div style={{
            maxWidth: 640,
            border: "1px solid #3a3b3d",
            borderRadius: 24,
            background: "#17181b",
            padding: 24,
            boxShadow: "0 24px 80px rgba(0,0,0,.35)",
          }}>
            <div style={{
              color: "#ffb4ab",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: ".18em",
              textTransform: "uppercase",
              marginBottom: 10,
            }}>
              Startup Error
            </div>
            <h1 style={{ margin: 0, fontSize: 24 }}>Galaxy AI Hub could not render.</h1>
            <p style={{ color: "#c4c7c5", lineHeight: 1.6 }}>
              The app stopped during startup before the interface could load. Your settings files are not deleted.
            </p>
            <pre style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              background: "#131314",
              border: "1px solid #282a2c",
              borderRadius: 16,
              padding: 14,
              color: "#ffdad6",
              fontSize: 12,
            }}>
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <StartupErrorBoundary>
    <App />
  </StartupErrorBoundary>,
);
