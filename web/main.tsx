import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { initializeEngine, validateWorkspace } from "./engine";
import { createStorage } from "./storage";
import { starterWorkspace } from "./data";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <div className="boot">
    <span className="fairtable-mark">F</span>
    <h1>Fairtable</h1>
    <p>Opening your workspace…</p>
    <div className="boot-progress" />
  </div>,
);
async function start() {
  await initializeEngine();
  const adapter = await createStorage();
  let saved = await adapter.load();
  if (!saved.workspace) {
    const workspace = starterWorkspace();
    validateWorkspace(workspace);
    const revision = await adapter.save(
      saved.revision,
      workspace,
      "Created starter workspace",
    );
    saved = { revision, workspace };
  }
  validateWorkspace(saved.workspace!);
  root.render(<App adapter={adapter} initial={saved} />);
}
void start().catch((error) =>
  root.render(
    <div className="boot">
      <span className="fairtable-mark">F</span>
      <h1>Couldn’t open your workspace</h1>
      <p className="error-message">
        {error instanceof Error ? error.message : String(error)}
      </p>
      <p>Your saved data has not been replaced.</p>
      <button onClick={() => location.reload()}>Try again</button>
    </div>,
  ),
);
