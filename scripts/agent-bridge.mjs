import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { dirname, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const bridgeRoot = resolve(process.env.AGENT_BRIDGE_DIR || resolve(projectRoot, ".agent-bridge"));
const statePath = resolve(bridgeRoot, "state.json");
const eventsPath = resolve(bridgeRoot, "events.jsonl");
const lockPath = resolve(bridgeRoot, "state.lock");
const validAgents = new Set(["codex", "claude"]);
const validRecipients = new Set(["codex", "claude", "user", "all"]);
const validStates = new Set(["idle", "working", "blocked", "done"]);
const validKinds = new Set(["decision", "question", "feedback", "progress", "result", "warning"]);
const staleLockAgeMs = 30_000;

function initialState() {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    agents: {
      codex: { state: "idle", task: "", files: [], updatedAt: null },
      claude: { state: "idle", task: "", files: [], updatedAt: null },
    },
    claims: [],
  };
}

function parseArgs(tokens) {
  const result = { _: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      result._.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) result[key] = true;
    else {
      result[key] = value;
      index += 1;
    }
  }
  return result;
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value.trim()) throw new Error(`Missing --${name}`);
  return value.trim();
}

function requireAgent(value, label = "agent") {
  if (!validAgents.has(value)) throw new Error(`Invalid ${label}: ${value}. Use codex or claude.`);
  return value;
}

function parseFiles(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => normalizeProjectPath(item))
    .filter(Boolean);
}

function normalizeProjectPath(value) {
  const normalized = posix.normalize(String(value).trim().replaceAll("\\", "/")).replace(/^\.\//, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.startsWith("/")) {
    throw new Error(`File claims must use project-relative paths: ${value}`);
  }
  return normalized;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function removeStaleLock() {
  try {
    const lockText = await readFile(lockPath, "utf8");
    const lockInfo = JSON.parse(lockText);
    const createdAt = Date.parse(lockInfo.createdAt);
    const isExpired = Number.isFinite(createdAt) && Date.now() - createdAt > staleLockAgeMs;
    if (isProcessAlive(lockInfo.pid) && !isExpired) return false;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    // A just-created lock can be briefly empty. Only recover malformed legacy
    // locks after their modification time proves they are abandoned.
    try {
      const lockStats = await stat(lockPath);
      if (Date.now() - lockStats.mtimeMs <= staleLockAgeMs) return false;
    } catch (statError) {
      if (statError?.code === "ENOENT") return true;
      throw statError;
    }
  }

  try {
    await unlink(lockPath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return true;
    throw error;
  }
}

async function ensureBridge() {
  await mkdir(bridgeRoot, { recursive: true, mode: 0o700 });
  try {
    await writeFile(statePath, `${JSON.stringify(initialState(), null, 2)}\n`, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  try {
    await writeFile(eventsPath, "", { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
}

async function readState() {
  await ensureBridge();
  return JSON.parse(await readFile(statePath, "utf8"));
}

async function withStateLock(update) {
  await ensureBridge();
  let lockHandle;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      lockHandle = await open(lockPath, "wx", 0o600);
      await lockHandle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await removeStaleLock()) continue;
      await sleep(50);
    }
  }
  if (!lockHandle) throw new Error("Agent bridge is busy. Try again in a moment.");

  try {
    const state = await readState();
    const result = await update(state);
    state.updatedAt = new Date().toISOString();
    const temporaryPath = `${statePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporaryPath, statePath);
    return result;
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch((error) => {
      if (error?.code !== "ENOENT") throw error;
    });
  }
}

async function postEvent({ from, to, kind, message, files = [] }) {
  requireAgent(from, "sender");
  if (!validRecipients.has(to)) throw new Error(`Invalid recipient: ${to}`);
  if (!validKinds.has(kind)) throw new Error(`Invalid kind: ${kind}`);
  const cleanMessage = String(message).trim();
  if (!cleanMessage) throw new Error("Message cannot be empty.");
  if (cleanMessage.length > 8_000) throw new Error("Message is too long; summarize it to 8,000 characters or fewer.");

  await ensureBridge();
  const event = {
    id: `${Date.now()}-${randomBytes(6).toString("hex")}`,
    timestamp: new Date().toISOString(),
    from,
    to,
    kind,
    message: cleanMessage,
    files,
  };
  await appendFile(eventsPath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
  return event;
}

async function readEvents() {
  await ensureBridge();
  const text = await readFile(eventsPath, "utf8");
  return text
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
}

function formatEvent(event) {
  const files = event.files?.length ? `\n  files: ${event.files.join(", ")}` : "";
  return `[${event.timestamp}] ${event.from} -> ${event.to} (${event.kind})\n  ${event.message}${files}`;
}

async function commandInit() {
  await ensureBridge();
  console.log(`Agent bridge ready: ${bridgeRoot}`);
}

async function commandPost(options) {
  const from = requireAgent(requireOption(options, "from"), "sender");
  const to = requireOption(options, "to");
  const kind = options.kind || "progress";
  const message = options.message || options._.join(" ");
  const event = await postEvent({ from, to, kind, message, files: parseFiles(options.files) });
  console.log(`Posted ${event.kind} message ${event.id}.`);
}

async function commandStatus(options) {
  const agent = requireAgent(requireOption(options, "agent"));
  const stateValue = requireOption(options, "state");
  if (!validStates.has(stateValue)) throw new Error(`Invalid state: ${stateValue}`);
  const task = typeof options.task === "string" ? options.task.trim() : "";
  const files = parseFiles(options.files);
  await withStateLock((state) => {
    state.agents[agent] = { state: stateValue, task, files, updatedAt: new Date().toISOString() };
  });
  console.log(`${agent} status: ${stateValue}${task ? ` — ${task}` : ""}`);
}

async function commandClaim(options) {
  const agent = requireAgent(requireOption(options, "agent"));
  const files = parseFiles(requireOption(options, "files"));
  const task = typeof options.task === "string" ? options.task.trim() : "";
  if (!files.length) throw new Error("At least one file is required.");

  await withStateLock((state) => {
    for (const file of files) {
      const conflict = state.claims.find((claim) => claim.agent !== agent && pathsOverlap(claim.path, file));
      if (conflict) {
        const error = new Error(`${file} overlaps ${conflict.path}, claimed by ${conflict.agent}.`);
        error.exitCode = 2;
        throw error;
      }
    }
    const existing = new Set(state.claims.filter((claim) => claim.agent === agent).map((claim) => claim.path));
    for (const file of files) {
      if (!existing.has(file)) {
        state.claims.push({ path: file, agent, task, claimedAt: new Date().toISOString() });
      }
    }
  });
  await postEvent({ from: agent, to: "all", kind: "progress", message: task || "파일 작업을 시작합니다.", files });
  console.log(`${agent} claimed: ${files.join(", ")}`);
}

async function commandRelease(options) {
  const agent = requireAgent(requireOption(options, "agent"));
  const files = parseFiles(options.files);
  let released = [];
  await withStateLock((state) => {
    const selected = state.claims.filter((claim) => (
      claim.agent === agent && (!files.length || files.some((file) => pathsOverlap(claim.path, file)))
    ));
    released = selected.map((claim) => claim.path);
    const releasedSet = new Set(selected);
    state.claims = state.claims.filter((claim) => !releasedSet.has(claim));
  });
  if (released.length) {
    await postEvent({ from: agent, to: "all", kind: "progress", message: "파일 작업 선점을 해제했습니다.", files: released });
  }
  console.log(released.length ? `${agent} released: ${released.join(", ")}` : `No claims held by ${agent}.`);
}

async function commandInbox(options) {
  const agent = requireAgent(requireOption(options, "agent"));
  const limit = Math.max(1, Math.min(Number(options.limit) || 30, 200));
  const events = (await readEvents())
    .filter((event) => event.from !== agent && (event.to === agent || event.to === "all"))
    .slice(-limit);
  console.log(events.length ? events.map(formatEvent).join("\n\n") : `No messages for ${agent}.`);
}

async function commandOverview() {
  const [state, events] = await Promise.all([readState(), readEvents()]);
  console.log("Agents:");
  for (const [agent, value] of Object.entries(state.agents)) {
    console.log(`- ${agent}: ${value.state}${value.task ? ` — ${value.task}` : ""}`);
  }
  console.log("Claims:");
  if (!state.claims.length) console.log("- none");
  else state.claims.forEach((claim) => console.log(`- ${claim.path}: ${claim.agent}${claim.task ? ` — ${claim.task}` : ""}`));
  console.log("Recent events:");
  const recent = events.slice(-8);
  console.log(recent.length ? recent.map(formatEvent).join("\n\n") : "- none");
}

function printHelp() {
  console.log(`Agent bridge commands:
  init
  overview
  inbox --agent codex|claude [--limit 30]
  status --agent codex|claude --state idle|working|blocked|done [--task "..."] [--files a,b]
  claim --agent codex|claude --files a,b [--task "..."]
  release --agent codex|claude [--files a,b]
  post --from codex|claude --to codex|claude|user|all --kind decision|question|feedback|progress|result|warning --message "..." [--files a,b]

Live data stays in ignored .agent-bridge/. Never post credentials, tokens, or full private conversations.`);
}

const [command = "help", ...tokens] = process.argv.slice(2);
const options = parseArgs(tokens);

try {
  if (command === "init") await commandInit();
  else if (command === "post") await commandPost(options);
  else if (command === "status") await commandStatus(options);
  else if (command === "claim") await commandClaim(options);
  else if (command === "release") await commandRelease(options);
  else if (command === "inbox") await commandInbox(options);
  else if (command === "overview") await commandOverview();
  else if (command === "help" || command === "--help" || command === "-h") printHelp();
  else throw new Error(`Unknown command: ${command}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 1;
}
