import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
mkdirSync("web/generated", { recursive: true });
for (const [cmd, args] of [
  [
    "cargo",
    [
      "build",
      "--locked",
      "-p",
      "fairtable-core",
      "--release",
      "--target",
      "wasm32-unknown-unknown",
      "--features",
      "wasm",
    ],
  ],
  [
    "wasm-bindgen",
    [
      "target/wasm32-unknown-unknown/release/fairtable_core.wasm",
      "--target",
      "web",
      "--out-dir",
      "web/generated",
      "--out-name",
      "fairtable_core",
    ],
  ],
]) {
  const result = spawnSync(cmd, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
