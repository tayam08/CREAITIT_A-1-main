import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const listenHost = "127.0.0.1";
const listenPort = 4502;
const pollIntervalMs = 1000;
const recentMessageLimit = 1000;
const allowedOrigins = new Set([`http://${listenHost}:${listenPort}`, `http://localhost:${listenPort}`]);
const securityHeaders = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'self' blob:; connect-src 'self' ws://127.0.0.1:4502 ws://localhost:4502; img-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const chatLogPath = resolve(projectRoot, ".runtime", "chat-logs.sqlite");
const chatLogDb = new DatabaseSync(chatLogPath);
chatLogDb.exec("PRAGMA busy_timeout = 5000");
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
`);
const messageColumns = chatLogDb.prepare("PRAGMA table_info(chat_messages)").all();
if (!messageColumns.some((column) => column.name === "session_id")) {
  chatLogDb.exec("ALTER TABLE chat_messages ADD COLUMN session_id TEXT");
}
chatLogDb.exec("CREATE INDEX IF NOT EXISTS chat_messages_session_id_idx ON chat_messages(session_id)");

const selectRecentMessages = chatLogDb.prepare(`SELECT id, session_id, visitor_name, role, content, created_at
  FROM chat_messages ORDER BY id DESC LIMIT ?`);
const selectRecentSessions = chatLogDb.prepare(`SELECT id, visitor_name, application_id, status, consent_at,
  integration_status, integration_error, started_at, ended_at, updated_at
  FROM chat_sessions ORDER BY updated_at DESC LIMIT 250`);

function readSnapshot() {
  return {
    sessions: selectRecentSessions.all(),
    messages: selectRecentMessages.all(recentMessageLimit).reverse(),
  };
}

function isAllowedOrigin(origin) {
  return typeof origin === "string" && allowedOrigins.has(origin);
}

const adminPageHtml = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LUNA 관리자 — 실시간 채팅 로그</title>
<style>
  :root{--bg:#020305;--panel:rgba(8,14,27,.9);--line:rgba(112,183,239,.18);--copy:#f1f6fb;--muted:#8290a6;--accent:#4ac1e8}
  *{box-sizing:border-box}html,body{margin:0;height:100%;background:radial-gradient(circle at 50% 0%,rgba(31,83,168,.18),transparent 45%),var(--bg);color:var(--copy);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}body{display:flex;flex-direction:column}
  header{display:flex;align-items:center;gap:14px;padding:16px 22px;border-bottom:1px solid var(--line);background:rgba(2,3,5,.86);backdrop-filter:blur(14px)}header h1{margin:0;font-size:15px;font-weight:600}.status{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:rgba(255,255,255,.06);font-size:11px;font-weight:600}.status i{width:6px;height:6px;border-radius:50%;background:#999}.status.connected i{background:#56d68d}.status.offline i{background:#d8695a}.search{margin-left:auto;padding:7px 12px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.04);color:var(--copy);font-size:12px;width:200px}
  .layout{flex:1;display:flex;min-height:0}.sidebar{flex:0 0 270px;overflow-y:auto;border-right:1px solid var(--line);padding:10px}.session{width:100%;padding:10px 12px;margin-bottom:4px;border:1px solid transparent;border-radius:10px;background:transparent;color:var(--copy);text-align:left;cursor:pointer}.session:hover{background:rgba(255,255,255,.04)}.session.active{border-color:var(--line);background:var(--panel)}.session strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.session span{display:flex;justify-content:space-between;gap:8px;margin-top:3px;font-size:11px;color:var(--muted)}.session.hidden{display:none}
  .thread{flex:1;overflow-y:auto;padding:20px 24px 80px}.empty{margin-top:60px;text-align:center;color:var(--muted)}.summary{display:grid;grid-template-columns:1fr auto;gap:7px 18px;align-items:center;margin-bottom:16px;padding:16px 18px;border:1px solid rgba(112,183,239,.22);border-radius:12px;background:linear-gradient(115deg,rgba(32,71,118,.34),var(--panel))}.summary h2{margin:0;font-size:16px}.summary p{margin:0;color:#91a2ba;font-size:11px}.actions{grid-column:2;grid-row:1/span 2;display:flex;gap:7px}.actions button{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:rgba(255,255,255,.06);color:var(--copy);cursor:pointer}
  .row{display:flex;gap:14px;padding:12px 14px;border:1px solid var(--line);border-radius:12px;margin-bottom:8px;background:var(--panel)}.meta{flex:0 0 120px;display:flex;flex-direction:column;gap:4px}.time{font-size:11px;color:var(--muted)}.role{align-self:flex-start;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:700}.user .role{background:rgba(112,183,239,.16);color:var(--accent)}.assistant .role{background:rgba(122,209,158,.16);color:#7ad19e}.content{flex:1;min-width:0;white-space:pre-wrap;overflow-wrap:anywhere;color:#dfe9f5}
  @media(max-width:760px){header{flex-wrap:wrap}.search{order:3;width:100%}.sidebar{flex-basis:190px}.summary{grid-template-columns:1fr}.actions{grid-column:1;grid-row:auto}.row{display:block}.meta{margin-bottom:8px}}
</style>
</head>
<body>
<header><h1>LUNA 관리자 · 실시간 채팅 로그</h1><span class="status offline" id="status"><i></i><span id="status-label">연결 중</span></span><input class="search" id="search" type="text" placeholder="이름 검색" /></header>
<div class="layout"><nav class="sidebar" id="sidebar"></nav><main class="thread" id="thread"><div class="empty">왼쪽에서 대화 세션을 선택하세요.</div></main></div>
<script>
  const sidebarEl=document.getElementById("sidebar"),threadEl=document.getElementById("thread"),statusEl=document.getElementById("status"),statusLabelEl=document.getElementById("status-label"),searchEl=document.getElementById("search");
  let sessions=[],messages=[],selectedId=null,searchValue="";
  const esc=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const time=(value)=>value?value.replace("T"," ").replace("Z",""):"—";
  function views(){
    const buckets=new Map();for(const message of messages){const id=message.session_id||"legacy:"+message.visitor_name;const bucket=buckets.get(id)||[];bucket.push(message);buckets.set(id,bucket)}
    const rows=sessions.map((session)=>({...session,messages:buckets.get(session.id)||[]}));
    for(const [id,bucket] of buckets){if(!id.startsWith("legacy:")||rows.some((row)=>row.id===id))continue;const last=bucket[bucket.length-1];rows.push({id,visitor_name:last.visitor_name,status:"ended",consent_at:"이전 형식",integration_status:"local_only",application_id:null,started_at:bucket[0].created_at,ended_at:last.created_at,updated_at:last.created_at,messages:bucket})}
    return rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  }
  function transcript(session){const lines=["CREAI+IT · LUNA 대화 기록","==================================","지원자: "+session.visitor_name,"세션 ID: "+session.id,"시작: "+session.started_at,"종료: "+(session.ended_at||"진행 중"),"채용 시스템 연결: "+(session.application_id||"연결 안 됨"),"저장 동의: "+session.consent_at,""];for(const message of session.messages){lines.push("["+message.created_at+"] "+(message.role==="assistant"?"LUNA":"지원자"),message.content,"")}return lines.join("\\n").trimEnd()+"\\n"}
  function renderSidebar(){const rows=views();sidebarEl.innerHTML="";for(const session of rows){const button=document.createElement("button");button.className="session"+(session.id===selectedId?" active":"")+(searchValue&&!session.visitor_name.toLowerCase().includes(searchValue)?" hidden":"");button.innerHTML="<strong>"+esc(session.visitor_name)+"</strong><span><b>"+session.messages.length+"개 · "+(session.status==="ended"?"종료":"진행 중")+"</b><b>"+esc(time(session.updated_at))+"</b></span>";button.onclick=()=>{selectedId=session.id;renderSidebar();renderThread()};sidebarEl.appendChild(button)}if(!selectedId&&rows[0])selectedId=rows[0].id}
  function download(session){const url=URL.createObjectURL(new Blob([transcript(session)],{type:"text/plain;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="luna-"+session.id.replace(/[^A-Za-z0-9_-]/g,"_")+".txt";link.click();URL.revokeObjectURL(url)}
  function printPdf(session){const popup=window.open("","_blank","noopener,noreferrer");if(!popup){alert("팝업을 허용해 주세요.");return}popup.document.title="LUNA 대화 기록 · "+session.visitor_name;popup.document.head.innerHTML='<meta charset="utf-8"><style>@page{size:A4;margin:18mm}body{color:#18202a;font:13px/1.7 -apple-system,BlinkMacSystemFont,"Noto Sans KR",sans-serif}h1{font-size:22px}pre{white-space:pre-wrap;font:12px/1.75 ui-monospace,monospace}button{position:fixed;right:18px;top:18px}@media print{button{display:none}}</style>';const h=popup.document.createElement("h1"),pre=popup.document.createElement("pre"),button=popup.document.createElement("button");h.textContent="CREAI+IT · LUNA 대화 기록";pre.textContent=transcript(session);button.textContent="PDF로 저장 / 인쇄";button.onclick=()=>popup.print();popup.document.body.append(h,pre,button);popup.focus()}
  function renderThread(){const session=views().find((row)=>row.id===selectedId);if(!session){threadEl.innerHTML='<div class="empty">왼쪽에서 대화 세션을 선택하세요.</div>';return}threadEl.innerHTML='<section class="summary"><h2>'+esc(session.visitor_name)+'</h2><p>'+(session.integration_status==="linked"?"채용 시스템 연결됨":"로컬 보관")+(session.application_id?" · 지원서 "+esc(session.application_id):"")+'</p><div class="actions"><button id="txt">TXT 다운로드</button><button id="pdf">PDF 저장 / 인쇄</button></div></section>'+session.messages.map((message)=>'<div class="row '+message.role+'"><div class="meta"><span class="role">'+(message.role==="assistant"?"LUNA":"USER")+'</span><span class="time">'+esc(time(message.created_at))+'</span></div><div class="content">'+esc(message.content)+'</div></div>').join("");document.getElementById("txt").onclick=()=>download(session);document.getElementById("pdf").onclick=()=>printPdf(session)}
  function replace(payload){sessions=payload.sessions||[];messages=payload.messages||[];const rows=views();if(!rows.some((row)=>row.id===selectedId))selectedId=rows[0]?.id||null;renderSidebar();renderThread()}
  searchEl.oninput=()=>{searchValue=searchEl.value.trim().toLowerCase();renderSidebar()};
  function connect(){const socket=new WebSocket("ws://"+location.host+"/ws");socket.onopen=()=>{statusEl.className="status connected";statusLabelEl.textContent="실시간 연결됨"};socket.onclose=()=>{statusEl.className="status offline";statusLabelEl.textContent="재연결 중";setTimeout(connect,1500)};socket.onerror=()=>socket.close();socket.onmessage=(event)=>{try{replace(JSON.parse(event.data))}catch{}}}connect();
</script>
</body></html>`;

const server = createServer((request, response) => {
  const origin = request.headers.origin;
  if (origin && !isAllowedOrigin(origin)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/" || url.pathname === "/admin") {
    response.writeHead(200, { ...securityHeaders, "Content-Type": "text/html; charset=utf-8" });
    response.end(adminPageHtml);
    return;
  }
  response.writeHead(404, { ...securityHeaders, "Content-Type": "text/plain; charset=utf-8" });
  response.end("Not found");
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient: ({ origin }, accept) => {
    if (isAllowedOrigin(origin)) accept(true);
    else accept(false, 403, "Local origin required");
  },
});

let lastSnapshot = JSON.stringify(readSnapshot());
wss.on("connection", (client) => client.send(lastSnapshot));
const pollTimer = setInterval(() => {
  const nextSnapshot = JSON.stringify(readSnapshot());
  if (nextSnapshot === lastSnapshot) return;
  lastSnapshot = nextSnapshot;
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(nextSnapshot);
}, pollIntervalMs);

server.listen(listenPort, listenHost, () => console.log(`LUNA admin dashboard: http://${listenHost}:${listenPort}`));
server.on("error", (error) => {
  console.error(`LUNA admin dashboard failed: ${error.message}`);
  process.exitCode = 1;
});

function shutdown() {
  clearInterval(pollTimer);
  for (const client of wss.clients) client.terminate();
  server.close(() => {
    chatLogDb.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
