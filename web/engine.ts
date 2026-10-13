import type { Workspace, Evaluation } from "./types";
let engine: typeof import("./generated/fairtable_core") | null = null;
export async function initializeEngine() {
  engine = await import("./generated/fairtable_core");
  await engine.default();
}
export function validateWorkspace(workspace: Workspace) {
  if (!engine) throw new Error("The calculation engine is still loading.");
  try {
    engine.validate(JSON.stringify(workspace));
  } catch (e) {
    throw new Error(String(e));
  }
}
export function evaluateWorkspace(workspace: Workspace): Evaluation {
  if (!engine) throw new Error("The calculation engine is still loading.");
  return JSON.parse(engine.evaluate(JSON.stringify(workspace)));
}
