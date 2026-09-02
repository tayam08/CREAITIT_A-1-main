import { env } from "cloudflare:workers";
import { asc, desc, eq } from "drizzle-orm";
import { ensureChatLogDatabase, getDb } from "../../../db";
import { chatMessages, chatSessions } from "../../../db/schema";

const maxVisitorNameLength = 80;
const maxContentLength = 20_000;
const maxErrorLength = 500;
const maxRequestBytes = 1_000_000;
const recentMessageLimit = 1_000;
const recentSessionLimit = 250;
const sessionIdPattern = /^[A-Za-z0-9:_-]{8,100}$/;

type ChatEventPayload = {
  type?: "session.started" | "message.created" | "session.ended";
  session_id?: string;
  visitor_name?: string;
  role?: string;
  content?: string;
  consent_at?: string;
  started_at?: string;
  ended_at?: string;
  application_id?: string | null;
  integration_status?: string;
  integration_error?: string | null;
};

async function isAuthorized(request: Request) {
  if (!env.ADMIN_KEY) return false;
  const actual = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${env.ADMIN_KEY}`);
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", actual),
    crypto.subtle.digest("SHA-256", expected),
  ]);
  const left = new Uint8Array(actualHash);
  const right = new Uint8Array(expectedHash);
  let mismatch = left.length ^ right.length;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

function cleanSessionId(value: string | undefined) {
  const sessionId = value?.trim();
  return sessionId && sessionIdPattern.test(sessionId) ? sessionId : null;
}

function cleanIsoDate(value: string | undefined, fallback = new Date().toISOString()) {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function buildTranscript(
  session: typeof chatSessions.$inferSelect,
  messages: (typeof chatMessages.$inferSelect)[],
) {
  const lines = [
    "CREAI+IT · LUNA 대화 기록",
    "=".repeat(34),
    `지원자: ${session.visitorName}`,
    `세션 ID: ${session.id}`,
    `시작: ${session.startedAt}`,
    `종료: ${session.endedAt ?? "진행 중"}`,
    `채용 시스템 연결: ${session.applicationId ?? "연결 안 됨"}`,
    `저장 동의: ${session.consentAt}`,
    "",
  ];
  for (const message of messages) {
    lines.push(`[${message.createdAt}] ${message.role === "assistant" ? "LUNA" : "지원자"}`);
    lines.push(message.content);
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function GET(request: Request) {
  if (!await isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureChatLogDatabase();

  const url = new URL(request.url);
  const sessionId = cleanSessionId(url.searchParams.get("session_id") ?? undefined);
  const format = url.searchParams.get("format");
  const db = getDb();

  if (sessionId && format === "txt") {
    const sessionRows = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
    const session = sessionRows[0];
    if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
    const messages = await db.select().from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId)).orderBy(asc(chatMessages.id));
    const fileName = `luna-${sessionId.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`;
    return new Response(buildTranscript(session, messages), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const [sessions, messageRows] = await Promise.all([
    db.select().from(chatSessions).orderBy(desc(chatSessions.updatedAt)).limit(recentSessionLimit),
    db.select().from(chatMessages).orderBy(desc(chatMessages.id)).limit(recentMessageLimit),
  ]);
  return Response.json(
    { sessions, messages: messageRows.reverse() },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  if (!await isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxRequestBytes) {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }

  const payload = await request.json().catch(() => null) as ChatEventPayload | null;
  if (!payload) return Response.json({ error: "Invalid JSON" }, { status: 400 });
  await ensureChatLogDatabase();

  const eventType = payload.type ?? "message.created";
  const sessionId = cleanSessionId(payload.session_id);
  const visitorName = payload.visitor_name?.trim().slice(0, maxVisitorNameLength);
  const now = new Date().toISOString();
  const db = getDb();

  if (eventType === "session.started") {
    if (!sessionId || !visitorName || !payload.consent_at) {
      return Response.json({ error: "session_id, visitor_name and consent_at are required" }, { status: 400 });
    }
    await env.DB.prepare(`INSERT INTO chat_sessions (
      id, visitor_name, application_id, status, consent_at, integration_status,
      integration_error, started_at, ended_at, updated_at
    ) VALUES (?, ?, NULL, 'active', ?, 'local_only', NULL, ?, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      visitor_name = excluded.visitor_name,
      consent_at = excluded.consent_at,
      updated_at = excluded.updated_at`)
      .bind(sessionId, visitorName, cleanIsoDate(payload.consent_at), cleanIsoDate(payload.started_at), now)
      .run();
    return Response.json({ ok: true, sessionId }, { status: 201 });
  }

  if (eventType === "session.ended") {
    if (!sessionId) return Response.json({ error: "session_id is required" }, { status: 400 });
    const integrationStatus = payload.integration_status?.trim().slice(0, 40) || "local_only";
    await env.DB.prepare(`UPDATE chat_sessions SET
      application_id = COALESCE(?, application_id), status = 'ended', ended_at = ?,
      integration_status = ?, integration_error = ?, updated_at = ?
      WHERE id = ?`)
      .bind(
        payload.application_id?.trim().slice(0, 160) || null,
        cleanIsoDate(payload.ended_at),
        integrationStatus,
        payload.integration_error?.trim().slice(0, maxErrorLength) || null,
        now,
        sessionId,
      ).run();
    return Response.json({ ok: true, sessionId });
  }

  const content = payload.content?.trim().slice(0, maxContentLength);
  const role = payload.role === "assistant" ? "assistant" : "user";
  if (!visitorName || !content) {
    return Response.json({ error: "visitor_name and content are required" }, { status: 400 });
  }
  if (sessionId) {
    await env.DB.prepare(`INSERT INTO chat_sessions (
      id, visitor_name, status, consent_at, integration_status, started_at, updated_at
    ) VALUES (?, ?, 'active', ?, 'local_only', ?, ?)
    ON CONFLICT(id) DO UPDATE SET visitor_name = excluded.visitor_name, updated_at = excluded.updated_at`)
      .bind(sessionId, visitorName, cleanIsoDate(payload.consent_at), cleanIsoDate(payload.started_at), now)
      .run();
  }
  await db.insert(chatMessages).values({ sessionId, visitorName, role, content });
  return Response.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  if (!await isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensureChatLogDatabase();

  const url = new URL(request.url);
  const sessionId = cleanSessionId(url.searchParams.get("session_id") ?? undefined);
  const visitorName = url.searchParams.get("visitor_name")?.trim().slice(0, maxVisitorNameLength);
  if (!sessionId && !visitorName) {
    return Response.json({ error: "session_id or visitor_name is required" }, { status: 400 });
  }

  if (sessionId) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chat_messages WHERE session_id = ?").bind(sessionId),
      env.DB.prepare("DELETE FROM chat_sessions WHERE id = ?").bind(sessionId),
    ]);
  } else if (visitorName) {
    await env.DB.batch([
      env.DB.prepare("DELETE FROM chat_messages WHERE visitor_name = ?").bind(visitorName),
      env.DB.prepare("DELETE FROM chat_sessions WHERE visitor_name = ?").bind(visitorName),
    ]);
  }
  return Response.json({ ok: true });
}
