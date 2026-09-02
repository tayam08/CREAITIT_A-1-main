"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

type ChatLogMessage = {
  id: number;
  sessionId: string | null;
  visitorName: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

type ChatLogSession = {
  id: string;
  visitorName: string;
  applicationId: string | null;
  status: "active" | "ended";
  consentAt: string;
  integrationStatus: "local_only" | "pending" | "linked" | "not_configured" | string;
  integrationError: string | null;
  startedAt: string;
  endedAt: string | null;
  updatedAt: string;
};

type SessionView = ChatLogSession & { messages: ChatLogMessage[]; legacy?: boolean };

const POLL_INTERVAL_MS = 1500;
const ADMIN_KEY_STORAGE_KEY = "luna-admin-key";
const ADMIN_KEY_CHANGE_EVENT = "luna-admin-key-change";

function subscribeAdminKey(onStoreChange: () => void) {
  window.addEventListener(ADMIN_KEY_CHANGE_EVENT, onStoreChange);
  return () => window.removeEventListener(ADMIN_KEY_CHANGE_EVENT, onStoreChange);
}

function getAdminKeySnapshot() {
  return sessionStorage.getItem(ADMIN_KEY_STORAGE_KEY);
}

function getAdminKeyServerSnapshot() {
  return null;
}

function commitAdminKey(value: string) {
  sessionStorage.setItem(ADMIN_KEY_STORAGE_KEY, value);
  window.dispatchEvent(new Event(ADMIN_KEY_CHANGE_EVENT));
}

function clearAdminKey() {
  sessionStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
  window.dispatchEvent(new Event(ADMIN_KEY_CHANGE_EVENT));
}

function formatTime(value: string | null) {
  return value ? value.replace("T", " ").replace("Z", "") : "—";
}

function integrationLabel(status: string) {
  if (status === "linked") return "채용 시스템 연결됨";
  if (status === "pending") return "연동 재시도 중";
  if (status === "not_configured") return "연동 설정 필요";
  return "로컬 보관";
}

function transcriptFor(session: SessionView) {
  const lines = [
    "CREAI+IT · LUNA 대화 기록",
    "==================================",
    `지원자: ${session.visitorName}`,
    `세션 ID: ${session.id}`,
    `시작: ${session.startedAt}`,
    `종료: ${session.endedAt ?? "진행 중"}`,
    `채용 시스템 연결: ${session.applicationId ?? "연결 안 됨"}`,
    `저장 동의: ${session.consentAt}`,
    "",
  ];
  for (const message of session.messages) {
    lines.push(`[${message.createdAt}] ${message.role === "assistant" ? "LUNA" : "지원자"}`);
    lines.push(message.content, "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export default function AdminPage() {
  const key = useSyncExternalStore(subscribeAdminKey, getAdminKeySnapshot, getAdminKeyServerSnapshot);
  const [keyDraft, setKeyDraft] = useState("");
  const [messages, setMessages] = useState<ChatLogMessage[]>([]);
  const [sessions, setSessions] = useState<ChatLogSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusNote, setStatusNote] = useState("연결 중");
  const threadRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (!key) return;
    let disposed = false;
    async function poll() {
      try {
        const response = await fetch("/api/chat-log", {
          headers: { Authorization: `Bearer ${key}` },
          cache: "no-store",
        });
        if (response.status === 401) {
          if (!disposed) {
            setStatusNote("키가 올바르지 않습니다");
            clearAdminKey();
          }
          return;
        }
        if (!response.ok) throw new Error(`Chat log request failed: ${response.status}`);
        const data = await response.json() as { sessions: ChatLogSession[]; messages: ChatLogMessage[] };
        if (!disposed) {
          setSessions(data.sessions);
          setMessages(data.messages);
          setStatusNote("실시간 연결됨");
        }
      } catch {
        if (!disposed) setStatusNote("연결 재시도 중");
      }
    }
    void poll();
    const interval = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [key]);

  const sessionViews = useMemo(() => {
    const messageBuckets = new Map<string, ChatLogMessage[]>();
    for (const message of messages) {
      const bucketId = message.sessionId ?? `legacy:${message.visitorName}`;
      const bucket = messageBuckets.get(bucketId) ?? [];
      bucket.push(message);
      messageBuckets.set(bucketId, bucket);
    }
    const rows: SessionView[] = sessions.map((session) => ({
      ...session,
      messages: messageBuckets.get(session.id) ?? [],
    }));
    for (const [id, legacyMessages] of messageBuckets) {
      if (!id.startsWith("legacy:") || rows.some((session) => session.id === id)) continue;
      const lastMessage = legacyMessages[legacyMessages.length - 1];
      rows.push({
        id,
        visitorName: lastMessage.visitorName,
        applicationId: null,
        status: "ended",
        consentAt: "이전 형식",
        integrationStatus: "local_only",
        integrationError: null,
        startedAt: legacyMessages[0].createdAt,
        endedAt: lastMessage.createdAt,
        updatedAt: lastMessage.createdAt,
        messages: legacyMessages,
        legacy: true,
      });
    }
    return rows
      .filter((session) => !search || session.visitorName.toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [messages, search, sessions]);

  const effectiveSessionId = selectedSessionId && sessionViews.some((session) => session.id === selectedSessionId)
    ? selectedSessionId
    : (sessionViews[0]?.id ?? null);
  const selectedSession = sessionViews.find((session) => session.id === effectiveSessionId) ?? null;

  useEffect(() => {
    const thread = threadRef.current;
    if (!thread || !stickToBottomRef.current) return;
    thread.scrollTo({ top: thread.scrollHeight, behavior: "auto" });
  }, [selectedSession]);

  function handleThreadScroll() {
    const thread = threadRef.current;
    if (!thread) return;
    const distanceFromBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight;
    stickToBottomRef.current = distanceFromBottom < 96;
  }

  function selectSession(id: string) {
    stickToBottomRef.current = true;
    setSelectedSessionId(id);
  }

  async function deleteSession(session: SessionView) {
    if (!key) return;
    if (!window.confirm(`"${session.visitorName}"님의 이 대화 세션을 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    const query = session.legacy
      ? `visitor_name=${encodeURIComponent(session.visitorName)}`
      : `session_id=${encodeURIComponent(session.id)}`;
    try {
      const response = await fetch(`/api/chat-log?${query}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}` },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setMessages((current) => current.filter((message) => session.legacy
        ? message.visitorName !== session.visitorName
        : message.sessionId !== session.id));
      setSessions((current) => current.filter((item) => item.id !== session.id));
      setSelectedSessionId(null);
    } catch {
      window.alert("삭제에 실패했습니다. 다시 시도해주세요.");
    }
  }

  function downloadText(session: SessionView) {
    const blob = new Blob([transcriptFor(session)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `luna-${session.visitorName}-${session.id.replace(/[^A-Za-z0-9_-]/g, "_")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printPdf(session: SessionView) {
    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      window.alert("팝업을 허용한 뒤 다시 시도해주세요.");
      return;
    }
    popup.document.title = `LUNA 대화 기록 · ${session.visitorName}`;
    popup.document.head.innerHTML = `<meta charset="utf-8"><style>
      @page{size:A4;margin:18mm}body{margin:0;color:#18202a;font:13px/1.7 -apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif}
      h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:#697586}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.75 ui-monospace,SFMono-Regular,Menlo,monospace}
      button{position:fixed;right:18px;top:18px;padding:9px 13px;border:0;border-radius:8px;background:#172033;color:white}@media print{button{display:none}}
    </style>`;
    const heading = popup.document.createElement("h1");
    heading.textContent = "CREAI+IT · LUNA 대화 기록";
    const note = popup.document.createElement("p");
    note.textContent = "운영진 검토용 · AI 요약은 채용 판단을 대신하지 않습니다.";
    const pre = popup.document.createElement("pre");
    pre.textContent = transcriptFor(session);
    const button = popup.document.createElement("button");
    button.textContent = "PDF로 저장 / 인쇄";
    button.onclick = () => popup.print();
    popup.document.body.append(heading, note, pre, button);
    popup.focus();
  }

  if (!key) {
    return (
      <main className="admin-gate">
        <form className="admin-gate-card" onSubmit={(event) => {
          event.preventDefault();
          const trimmed = keyDraft.trim();
          if (trimmed) commitAdminKey(trimmed);
        }}>
          <h1>LUNA 관리자</h1>
          <p>접근 키를 입력하세요</p>
          <input type="password" value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder="관리자 키" autoFocus />
          <button type="submit" disabled={!keyDraft.trim()}>입장</button>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <h1>LUNA 관리자 · 실시간 채팅 로그</h1>
        <span className="admin-status">{statusNote}</span>
        <input className="admin-search" type="text" placeholder="이름 검색" value={search} onChange={(event) => setSearch(event.target.value)} />
      </header>
      <div className="admin-layout">
        <nav className="admin-sidebar">
          {sessionViews.map((session) => (
            <div key={session.id} className={`admin-visitor ${session.id === effectiveSessionId ? "active" : ""}`}>
              <button type="button" className="admin-visitor-select" onClick={() => selectSession(session.id)}>
                <span className="admin-visitor-name">{session.visitorName}</span>
                <span className="admin-visitor-meta"><span>{session.messages.length}개 · {session.status === "ended" ? "종료" : "진행 중"}</span><span>{formatTime(session.updatedAt)}</span></span>
              </button>
              <button type="button" className="admin-visitor-delete" aria-label={`${session.visitorName} 대화 삭제`} onClick={() => void deleteSession(session)}>✕</button>
            </div>
          ))}
          {sessionViews.length === 0 && <p className="admin-empty">아직 기록된 대화가 없습니다.</p>}
        </nav>
        <div
          className="admin-thread"
          ref={threadRef}
          onScroll={handleThreadScroll}
          onWheelCapture={(event) => {
            if (event.deltaY < 0) stickToBottomRef.current = false;
          }}
        >
          {selectedSession ? (
            <>
              <section className="admin-session-summary">
                <div><strong>{selectedSession.visitorName}</strong><span>{selectedSession.status === "ended" ? "대화 종료" : "대화 진행 중"}</span></div>
                <p>{integrationLabel(selectedSession.integrationStatus)}{selectedSession.applicationId ? ` · 지원서 ${selectedSession.applicationId}` : ""}</p>
                <div className="admin-export-actions">
                  <button type="button" onClick={() => downloadText(selectedSession)}>TXT 다운로드</button>
                  <button type="button" onClick={() => printPdf(selectedSession)}>PDF 저장 / 인쇄</button>
                </div>
              </section>
              {selectedSession.messages.map((message) => (
                <article key={message.id} className={`admin-row ${message.role}`}>
                  <div className="admin-row-meta"><span className="admin-role">{message.role === "assistant" ? "LUNA" : "USER"}</span><span className="admin-time">{formatTime(message.createdAt)}</span></div>
                  <div className="admin-content">{message.content}</div>
                </article>
              ))}
            </>
          ) : <p className="admin-empty">왼쪽에서 대화 세션을 선택하세요.</p>}
        </div>
      </div>
    </main>
  );
}
