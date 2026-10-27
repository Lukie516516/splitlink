// Real Studio source, supplemented externally after export; no Studio telemetry or private console capture.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initManifest } from "./lib/manifest";
import "./index.css";
const root = createRoot(document.getElementById("root")!);
initManifest()
  .then(() =>
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    ),
  )
  .catch((e) =>
    root.render(
      <main>
        <h1>Configuration unavailable</h1>
        <p>{String(e)}</p>
      </main>,
    ),
  );
