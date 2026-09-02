import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { ensureRuntimeToken } from "./runtime-token.mjs";

const scriptProjectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(resolve(scriptProjectRoot, ".env"));
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const listenHost = "127.0.0.1";
const listenPort = 4501;
const upstreamUrl = "ws://127.0.0.1:4500";
const maxQueuedMessages = 64;
const maxPayloadBytes = 1024 * 1024;
const maxVisitorNameLength = 80;
const maxContentLength = 20_000;
const maxStoredMessages = 10_000;
const pruneInterval = 100;
const outboxPollIntervalMs = 5_000;
const sessionIdPattern = /^[A-Za-z0-9:_-]{8,100}$/;
const allowedOrigins = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);
for (const origin of (process.env.LUNA_EXTRA_ALLOWED_ORIGINS ?? "").split(",")) {
  const trimmed = origin.trim();
  if (trimmed) allowedOrigins.add(trimmed);
}

const capabilityToken = await ensureRuntimeToken();
const remoteLogUrl = process.env.LUNA_REMOTE_LOG_URL?.trim() || null;
const remoteLogKey = process.env.LUNA_REMOTE_LOG_KEY?.trim() || null;
const hiringIngestUrl = process.env.LUNA_HIRING_INGEST_URL?.trim() || null;

const chatLogPath = resolve(scriptProjectRoot, ".runtime", "chat-logs.sqlite");
await mkdir(dirname(chatLogPath), { recursive: true });
const chatLogDb = new DatabaseSync(chatLogPath);
chatLogDb.exec("PRAGMA busy_timeout = 5000");
chatLogDb.exec("PRAGMA journal_mode = WAL");
chatLogDb.exec("PRAGMA foreign_keys = ON");
chatLogDb.exec(`
  CREATE TABLE IF NOT EXISTS chat_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_name TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    visitor_name TEXT NOT NULL,
    application_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    consent_at TEXT NOT NULL,
    integration_status TEXT NOT NULL DEFAULT 'local_only',
    integration_error TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS chat_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    destination TEXT NOT NULL,
    event_type TEXT NOT NULL,
    session_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at);
  CREATE INDEX IF NOT EXISTS chat_outbox_next_attempt_idx ON chat_outbox(next_attempt_at, id);
`);
const messageColumns = chatLogDb.prepare("PRAGMA table_info(chat_messages)").all();
if (!messageColumns.some((column) => column.name === "session_id")) {
  chatLogDb.exec("ALTER TABLE chat_messages ADD COLUMN session_id TEXT");
}
chatLogDb.exec("CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id)");

const insertChatMessage = chatLogDb.prepare(
  "INSERT INTO chat_messages (session_id, visitor_name, role, content) VALUES (?, ?, ?, ?)"
);
const upsertSession = chatLogDb.prepare(`INSERT INTO chat_sessions (
  id, visitor_name, application_id, status, consent_at, integration_status,
  integration_error, started_at, ended_at, updated_at
) VALUES (?, ?, NULL, 'active', ?, 'local_only', NULL, ?, NULL, ?)
ON CONFLICT(id) DO UPDATE SET
  visitor_name = excluded.visitor_name,
  consent_at = excluded.consent_at,
  updated_at = excluded.updated_at`);
const finishSession = chatLogDb.prepare(`UPDATE chat_sessions SET
  application_id = COALESCE(?, application_id), status = 'ended', ended_at = ?,
  integration_status = ?, integration_error = ?, updated_at = ? WHERE id = ?`);
const updateSessionIntegration = chatLogDb.prepare(`UPDATE chat_sessions SET
  application_id = COALESCE(?, application_id), integration_status = ?,
  integration_error = ?, updated_at = ? WHERE id = ?`);
const selectSession = chatLogDb.prepare(`SELECT id, visitor_name, application_id, status,
  consent_at, integration_status, integration_error, started_at, ended_at
  FROM chat_sessions WHERE id = ?`);
const selectSessionMessages = chatLogDb.prepare(`SELECT role, content, created_at
  FROM chat_messages WHERE session_id = ? ORDER BY id`);
const pruneChatMessages = chatLogDb.prepare(
  "DELETE FROM chat_messages WHERE id <= (SELECT COALESCE(MAX(id), 0) - ? FROM chat_messages)"
);
const insertOutbox = chatLogDb.prepare(`INSERT INTO chat_outbox
  (destination, event_type, session_id, payload_json) VALUES (?, ?, ?, ?)`);
const selectOutbox = chatLogDb.prepare(`SELECT id, destination, event_type, session_id, payload_json, attempts
  FROM chat_outbox WHERE next_attempt_at <= datetime('now') ORDER BY id LIMIT 50`);
const deleteOutbox = chatLogDb.prepare("DELETE FROM chat_outbox WHERE id = ?");
const failOutbox = chatLogDb.prepare(`UPDATE chat_outbox SET attempts = attempts + 1,
  next_attempt_at = datetime('now', ?), last_error = ? WHERE id = ?`);

pruneChatMessages.run(maxStoredMessages);
let messagesSincePrune = 0;
let outboxFlushPromise = null;

function cleanIsoDate(value, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function enqueue(destination, eventType, sessionId, payload) {
  insertOutbox.run(destination, eventType, sessionId, JSON.stringify(payload));
  void flushOutbox();
}

async function postRemote(payload) {
  if (!remoteLogUrl) throw new Error("Remote log URL is not configured");
  const response = await fetch(remoteLogUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(remoteLogKey ? { Authorization: `Bearer ${remoteLogKey}` } : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Remote log HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function postHiring(token, payload) {
  if (!hiringIngestUrl) throw new Error("Hiring ingestion URL is not configured");
  const response = await fetch(hiringIngestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Hiring ingestion HTTP ${response.status}`);
  return result;
}

async function deliverOutboxRow(row) {
  const payload = JSON.parse(row.payload_json);
  if (row.destination === "remote") return postRemote(payload);
  if (row.destination === "hiring") {
    const result = await postHiring(payload.token, payload.body);
    updateSessionIntegration.run(
      result.applicationId ?? null,
      "linked",
      null,
      new Date().toISOString(),
      row.session_id,
    );
    const session = selectSession.get(row.session_id);
    if (remoteLogUrl && session) {
      insertOutbox.run("remote", "session.ended", row.session_id, JSON.stringify({
        type: "session.ended",
        session_id: row.session_id,
        ended_at: session.ended_at,
        application_id: result.applicationId ?? session.application_id ?? null,
        integration_status: "linked",
        integration_error: null,
      }));
    }
    return result;
  }
  throw new Error("Unknown outbox destination");
}

async function flushOutboxInternal() {
  for (const row of selectOutbox.all()) {
    try {
      await deliverOutboxRow(row);
      deleteOutbox.run(row.id);
    } catch (error) {
      const delaySeconds = Math.min(300, 5 * 2 ** Math.min(row.attempts, 6));
      const message = error instanceof Error ? error.message : "Outbox delivery failed";
      failOutbox.run(`+${delaySeconds} seconds`, message.slice(0, 500), row.id);
      if (row.destination === "hiring") {
        updateSessionIntegration.run(null, "pending", message.slice(0, 500), new Date().toISOString(), row.session_id);
      }
    }
  }
}

function flushOutbox() {
  if (!outboxFlushPromise) {
    outboxFlushPromise = flushOutboxInternal().finally(() => {
      outboxFlushPromise = null;
    });
  }
  return outboxFlushPromise;
}

function startChatSession(context) {
  const now = new Date().toISOString();
  upsertSession.run(context.sessionId, context.visitorName, context.consentAt, context.startedAt, now);
  if (remoteLogUrl) {
    enqueue("remote", "session.started", context.sessionId, {
      type: "session.started",
      session_id: context.sessionId,
      visitor_name: context.visitorName,
      consent_at: context.consentAt,
      started_at: context.startedAt,
    });
  }
  return { ok: true, sessionId: context.sessionId };
}

function logChatMessage(context, role, content) {
  const normalizedRole = role === "assistant" ? "assistant" : "user";
  const normalizedContent = content.trim().slice(0, maxContentLength);
  if (!normalizedContent) return;

  insertChatMessage.run(context.sessionId, context.visitorName, normalizedRole, normalizedContent);
  messagesSincePrune += 1;
  if (messagesSincePrune >= pruneInterval) {
    pruneChatMessages.run(maxStoredMessages);
    messagesSincePrune = 0;
  }
  if (remoteLogUrl) {
    enqueue("remote", "message.created", context.sessionId, {
      type: "message.created",
      session_id: context.sessionId,
      visitor_name: context.visitorName,
      role: normalizedRole,
      content: normalizedContent,
      consent_at: context.consentAt,
      started_at: context.startedAt,
    });
  }
}

async function endChatSession(context) {
  const endedAt = new Date().toISOString();
  let applicationId = null;
  let integrationStatus = context.inviteToken ? (hiringIngestUrl ? "pending" : "not_configured") : "local_only";
  let integrationError = context.inviteToken && !hiringIngestUrl ? "채용 시스템 수신 URL이 설정되지 않았습니다." : null;

  finishSession.run(applicationId, endedAt, integrationStatus, integrationError, endedAt, context.sessionId);
  if (context.inviteToken && hiringIngestUrl) {
    const messages = selectSessionMessages.all(context.sessionId).map((message) => ({
      role: message.role,
      content: message.content,
      created_at: new Date(`${message.created_at}Z`).getTime(),
    }));
    enqueue("hiring", "conversation.completed", context.sessionId, {
      token: context.inviteToken,
      body: {
        session_id: context.sessionId,
        visitor_name: context.visitorName,
        consent_at: new Date(context.consentAt).getTime(),
        started_at: new Date(context.startedAt).getTime(),
        ended_at: new Date(endedAt).getTime(),
        messages,
      },
    });
    await flushOutbox();
    const current = selectSession.get(context.sessionId);
    applicationId = current?.application_id ?? null;
    integrationStatus = current?.integration_status ?? integrationStatus;
    integrationError = current?.integration_error ?? null;
  }
  if (remoteLogUrl) {
    enqueue("remote", "session.ended", context.sessionId, {
      type: "session.ended",
      session_id: context.sessionId,
      ended_at: endedAt,
      application_id: applicationId,
      integration_status: integrationStatus,
      integration_error: integrationError,
    });
    await flushOutbox();
  }
  return { ok: true, sessionId: context.sessionId, applicationId, integrationStatus };
}

function readSessionContext(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const visitorName = url.searchParams.get("name")?.trim().slice(0, maxVisitorNameLength) || "익명";
  const suppliedSessionId = url.searchParams.get("session_id")?.trim();
  const sessionId = suppliedSessionId && sessionIdPattern.test(suppliedSessionId) ? suppliedSessionId : randomUUID();
  const rawInvite = url.searchParams.get("invite")?.trim() || null;
  const inviteToken = rawInvite && rawInvite.length <= 4_096 ? rawInvite : null;
  const consentAt = cleanIsoDate(url.searchParams.get("consent_at"));
  return { visitorName, sessionId, inviteToken, consentAt, startedAt: new Date().toISOString() };
}

function sendRpcResult(socket, id, result) {
  if (typeof id === "number" && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ id, result }));
  }
}

function sendRpcError(socket, id, error) {
  if (typeof id === "number" && socket.readyState === WebSocket.OPEN) {
    const message = error instanceof Error ? error.message : "Local bridge request failed";
    socket.send(JSON.stringify({ id, error: { message } }));
  }
}

const server = new WebSocketServer({
  host: listenHost,
  port: listenPort,
  maxPayload: maxPayloadBytes,
  perMessageDeflate: false,
  verifyClient: ({ origin }, accept) => {
    if (origin && allowedOrigins.has(origin)) accept(true);
    else accept(false, 403, "Local origin required");
  },
});

server.on("connection", (browserSocket, request) => {
  const context = readSessionContext(request.url);
  startChatSession(context);
  const upstream = new WebSocket(upstreamUrl, {
    headers: { Authorization: `Bearer ${capabilityToken}` },
  });
  const queuedMessages = [];

  upstream.on("open", () => {
    while (queuedMessages.length > 0) upstream.send(queuedMessages.shift());
  });

  browserSocket.on("message", (data) => {
    const text = data.toString();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }

    if (parsed?.method === "chat/log" && typeof parsed.params?.content === "string") {
      logChatMessage(context, parsed.params.role, parsed.params.content);
      return;
    }
    if (parsed?.method === "chat/session/start") {
      sendRpcResult(browserSocket, parsed.id, startChatSession(context));
      return;
    }
    if (parsed?.method === "chat/session/end") {
      void endChatSession(context)
        .then((result) => sendRpcResult(browserSocket, parsed.id, result))
        .catch((error) => sendRpcError(browserSocket, parsed.id, error));
      return;
    }

    if (upstream.readyState === WebSocket.OPEN) upstream.send(text);
    else if (upstream.readyState === WebSocket.CONNECTING) {
      if (queuedMessages.length >= maxQueuedMessages) {
        browserSocket.close(1013, "Local Codex is still starting");
        return;
      }
      queuedMessages.push(text);
    }
  });

  upstream.on("message", (data) => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data.toString());
  });
  browserSocket.on("close", () => {
    if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) upstream.close();
  });
  upstream.on("close", () => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, "Local Codex connection closed");
  });
  upstream.on("error", () => {
    if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(1011, "Local Codex is not ready");
  });
});

const outboxTimer = setInterval(() => void flushOutbox(), outboxPollIntervalMs);
outboxTimer.unref();
void flushOutbox();

server.on("listening", () => {
  console.log(`LUNA browser bridge: ws://${listenHost}:${listenPort}`);
  console.log(`LUNA local chat log: ${chatLogPath}`);
  console.log(remoteLogUrl ? "LUNA remote chat log: enabled" : "LUNA remote chat log: disabled");
  console.log(hiringIngestUrl ? "LUNA hiring integration: enabled" : "LUNA hiring integration: disabled");
});

server.on("error", (error) => {
  console.error(`LUNA browser bridge failed: ${error.message}`);
  process.exitCode = 1;
});

function shutdown() {
  clearInterval(outboxTimer);
  for (const client of server.clients) client.terminate();
  server.close(() => {
    chatLogDb.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
