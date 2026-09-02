import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensureRuntimeToken, runtimeTokenPath } from "./runtime-token.mjs";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const codexEntrypoint = resolve(projectRoot, "node_modules", "@openai", "codex", "bin", "codex.js");

await ensureRuntimeToken();

const child = spawn(process.execPath, [
  codexEntrypoint,
  "app-server",
  "--listen",
  "ws://127.0.0.1:4500",
  "--ws-auth",
  "capability-token",
  "--ws-token-file",
  runtimeTokenPath,
], { cwd: projectRoot, stdio: "inherit" });

child.on("error", (error) => {
  console.error(`Could not start the local Codex app-server: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
