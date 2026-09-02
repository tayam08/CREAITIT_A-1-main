import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the LUNA voxel chat", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>면접용 로컬 챗 v1[^<]*LUNA<\/title>/i);
  assert.match(html, /Welcome/);
  assert.match(html, /CREAI\+IT/);
  assert.match(html, /무엇이든 물어보세요/);
  assert.match(html, /LOCAL SESSION/);
  assert.doesNotMatch(html, /ASSEMBLY STUDIO|CAD assembly workspace|Outer shell/i);
});

test("keeps the voxel reference and ChatGPT-style conversation behavior explicit", async () => {
  const [page, css, layout, packageJson, designRecord] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../docs/luna-voxel-chat-design-record.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /function VoxelScene/);
  assert.match(page, /new THREE\.WebGLRenderer/);
  assert.match(page, /void import\("three"\)/);
  assert.doesNotMatch(page, /import \* as THREE from "three"/);
  assert.match(page, /minimumFrameTime/);
  assert.match(page, /ws:\/\/127\.0\.0\.1:4501/);
  assert.match(page, /const TARGET_MODEL_ID = "gpt-5\.6-luna"/);
  assert.doesNotMatch(page, /model\.isDefault/);
  assert.match(page, /className="message-list"/);
  assert.match(page, /event\.key === "Enter" && !event\.shiftKey/);
  assert.match(page, /startNewChat/);
  assert.match(page, /streamedDeltaBuffer/);
  assert.match(page, /RPC_TIMEOUT_MS = 20_000/);
  assert.doesNotMatch(page, /CAD|assembly|Outer shell|Vision node/i);

  assert.match(css, /--paper:\s*#f5f4ef/i);
  assert.match(css, /--lilac:\s*#e9e0f8/i);
  assert.match(css, /--font-pixel/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(layout, /lang="ko"/);
  assert.match(packageJson, /"three"/);
  assert.match(designRecord, /Comprehension thesis/);
  assert.match(designRecord, /Visual thesis/);

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});

test("restores the CREAI+IT living-emblem logo concept", async () => {
  const response = await render("/logo-concept");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /<title>면접용 로컬 챗 v1[^<]*CREAI\+IT<\/title>/i);
  assert.match(html, /WELCOME TO/);
  assert.match(html, /CREAI\+IT/);

  const [page, css, route, logo] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/logo-concept.css", import.meta.url), "utf8"),
    readFile(new URL("../app/logo-concept/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../public/creait-logo-original.png", import.meta.url)),
  ]);

  assert.match(page, /function LogoScene/);
  assert.match(page, /new THREE\.ExtrudeGeometry/);
  assert.match(page, /new THREE\.MeshPhysicalMaterial/);
  assert.match(page, /new THREE\.ShapeGeometry\(logoShape/);
  assert.match(page, /const reliefDepth = 0\.16/);
  assert.match(page, /const continuousSpin = frontInspection \? 0 : reducedMotion\.matches \? -0\.12 : time \* 0\.34/);
  assert.match(page, /sourceTexture\.colorSpace = THREE\.NoColorSpace/);
  assert.match(page, /\* 63\.0 \+ 0\.5\) \/ 63\.0/);
  assert.match(page, /frontInspection \? 0\.146/);
  assert.match(page, /concept !== "logo"/);
  assert.doesNotMatch(page, /CONVERSATION ENGINE V\.01/);
  assert.match(page, /LunaExperience\(\{ concept = "voxel"/);
  assert.match(css, /\.logo-concept-shell/);
  assert.match(css, /\.logo-hero-lockup/);
  assert.match(route, /<LunaExperience concept="logo" \/>/);
  assert.ok(logo.byteLength > 300_000);
});

test("packages a local-only, per-user ChatGPT launcher", async () => {
  const [packageJson, readme, proxy, localAdmin, appServer, runtimeToken, launcher, windowsLauncher, gitignore, viteConfig, layout, chatLogRoute, chatPage] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../scripts/luna-proxy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/luna-admin.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/run-app-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/runtime-token.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/launch-local.mjs", import.meta.url), "utf8"),
    readFile(new URL("../START_INTERVIEW_CHAT.cmd", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/api/chat-log/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(packageJson, /"name": "interview-local-chat-v1"/);
  assert.match(packageJson, /"version": "1\.0\.0"/);
  assert.match(readme, /면접용_로컬_챗_v1/);
  assert.match(readme, /각 사용자의/);
  assert.match(proxy, /allowedOrigins/);
  assert.match(proxy, /maxQueuedMessages = 64/);
  assert.match(proxy, /maxPayload: maxPayloadBytes/);
  assert.match(proxy, /Authorization: `Bearer \$\{capabilityToken\}`/);
  assert.match(proxy, /process\.env\.LUNA_REMOTE_LOG_URL\?\.trim\(\) \|\| null/);
  assert.match(proxy, /CREATE TABLE IF NOT EXISTS chat_sessions/);
  assert.match(proxy, /CREATE TABLE IF NOT EXISTS chat_outbox/);
  assert.match(proxy, /chat\/session\/end/);
  assert.doesNotMatch(proxy, /workers\.dev/);
  assert.match(localAdmin, /TXT 다운로드/);
  assert.match(localAdmin, /PDF 저장 \/ 인쇄/);
  assert.match(appServer, /"--ws-auth"/);
  assert.match(appServer, /"capability-token"/);
  assert.match(runtimeToken, /randomBytes\(48\)/);
  assert.match(launcher, /http:\/\/localhost:3000\/logo-concept/);
  assert.match(windowsLauncher, /npm ci/);
  assert.match(gitignore, /\/\.runtime\//);
  assert.match(viteConfig, /host: "localhost"/);
  assert.match(viteConfig, /port: 3000/);
  assert.match(viteConfig, /strictPort: true/);
  assert.match(layout, /const localOrigin = new URL\("http:\/\/localhost:3000"\)/);
  assert.doesNotMatch(layout, /x-forwarded-host|x-forwarded-proto/i);
  assert.match(chatLogRoute, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(chatLogRoute, /export async function POST[\s\S]*if \(!await isAuthorized\(request\)\)/);
  assert.match(chatLogRoute, /session\.started/);
  assert.match(chatLogRoute, /session\.ended/);
  assert.match(chatPage, /대화 기록 저장 및 운영진 검토 목적의 문서화에 동의합니다/);
  assert.match(chatPage, /crypto\.randomUUID\(\)/);
});
