import { WebSocket } from "ws";
import { ensureRuntimeToken } from "./runtime-token.mjs";

const TARGET_MODEL_ID = "gpt-5.6-luna";
const capabilityToken = await ensureRuntimeToken();

const socket = new WebSocket("ws://127.0.0.1:4500", {
  headers: { Authorization: `Bearer ${capabilityToken}` },
});
const pending = new Map();
let nextId = 1;
let threadId = null;
let answer = "";

function request(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ method, id, params }));
  });
}

socket.addEventListener("message", async (event) => {
  const message = JSON.parse(String(event.data));
  if (typeof message.id === "number" && pending.has(message.id)) {
    const handler = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) handler.reject(new Error(message.error.message));
    else handler.resolve(message.result);
    return;
  }

  if (message.method === "item/agentMessage/delta") answer += message.params?.delta ?? "";
  if (message.method === "turn/completed") {
    if (message.params?.turn?.error) throw new Error(message.params.turn.error.message);
    clearTimeout(timeoutId);
    console.log(answer.trim());
    socket.terminate();
  }
});

socket.addEventListener("open", async () => {
  await request("initialize", {
    clientInfo: { name: "interview_local_chat_v1_smoke", title: "면접용 로컬 챗 v1 Smoke Test", version: "1.0.0" },
  });
  socket.send(JSON.stringify({ method: "initialized", params: {} }));
  const account = await request("account/read", { refreshToken: true });
  if (!account?.account) throw new Error("ChatGPT sign-in required");
  const models = await request("model/list", { limit: 20, includeHidden: false });
  const model = models?.data?.find((item) => item.model === TARGET_MODEL_ID);
  if (!model) throw new Error(`${TARGET_MODEL_ID} is not available for this account`);
  const thread = await request("thread/start", {
    model: TARGET_MODEL_ID,
    approvalPolicy: "never",
    sandbox: "read-only",
    personality: "friendly",
    serviceName: "interview_local_chat_v1_smoke",
  });
  threadId = thread.thread.id;
  await request("turn/start", {
    threadId,
    input: [{ type: "text", text: "Reply with exactly: LUNA-LIVE" }],
    approvalPolicy: "never",
    sandboxPolicy: { type: "readOnly", access: { type: "fullAccess" } },
  });
});

socket.addEventListener("error", () => {
  clearTimeout(timeoutId);
  console.error("Could not connect to the local Codex app-server.");
  process.exitCode = 1;
});

const timeoutId = setTimeout(() => {
  if (socket.readyState !== WebSocket.CLOSED) {
    console.error("Timed out waiting for the model response.");
    socket.terminate();
    process.exitCode = 1;
  }
}, 90000);
