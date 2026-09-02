import { spawn } from "node:child_process";

const appUrl = "http://localhost:3000/logo-concept";
const healthUrl = appUrl;
const windows = process.platform === "win32";
const child = windows
  ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "npm run local"], { stdio: "inherit" })
  : spawn("npm", ["run", "local"], { stdio: "inherit" });

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForSite() {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("The local services stopped before the page was ready.");
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_500) });
      if (response.ok) return;
    } catch {
      // The local web process is still warming up.
    }
    await wait(500);
  }
  throw new Error("Timed out while waiting for http://localhost:3000.");
}

function openBrowser() {
  const command = windows
    ? { file: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "start", "", appUrl] }
    : process.platform === "darwin"
      ? { file: "open", args: [appUrl] }
      : { file: "xdg-open", args: [appUrl] };
  const browser = spawn(command.file, command.args, { detached: true, stdio: "ignore", windowsHide: true });
  browser.unref();
}

waitForSite()
  .then(() => {
    console.log(`Opening ${appUrl}`);
    openBrowser();
  })
  .catch((error) => {
    console.error(error.message);
    child.kill();
    process.exitCode = 1;
  });

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
