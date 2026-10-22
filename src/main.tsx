import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadManifests } from "./core/manifest";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
loadManifests()
  .then(() =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
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
