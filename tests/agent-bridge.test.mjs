import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = new URL("../scripts/agent-bridge.mjs", import.meta.url);

test("coordinates Codex and Claude without committing live messages", async (context) => {
  const bridgeDirectory = await mkdtemp(join(tmpdir(), "creaitit-agent-bridge-"));
  context.after(() => rm(bridgeDirectory, { recursive: true, force: true }));

  const run = (...args) => spawnSync(process.execPath, [script.pathname, ...args], {
    encoding: "utf8",
    env: { ...process.env, AGENT_BRIDGE_DIR: bridgeDirectory },
  });

  assert.equal(run("init").status, 0);
  assert.equal(run("status", "--agent", "codex", "--state", "working", "--task", "Bridge test").status, 0);
  assert.equal(run("claim", "--agent", "codex", "--files", "app/page.tsx", "--task", "Bridge test").status, 0);
  assert.equal(run(
    "post",
    "--from", "codex",
    "--to", "claude",
    "--kind", "feedback",
    "--message", "Please review the current page.",
    "--files", "app/page.tsx",
  ).status, 0);

  const inbox = run("inbox", "--agent", "claude");
  assert.equal(inbox.status, 0);
  assert.match(inbox.stdout, /Please review the current page/);
  assert.match(inbox.stdout, /app\/page\.tsx/);

  const conflict = run("claim", "--agent", "claude", "--files", "app/page.tsx", "--task", "Conflicting edit");
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /claimed by codex/);

  assert.equal(run("release", "--agent", "codex").status, 0);
  assert.equal(run("claim", "--agent", "claude", "--files", "app/page.tsx", "--task", "Review").status, 0);

  await writeFile(
    join(bridgeDirectory, "state.lock"),
    `${JSON.stringify({ pid: 999_999_999, createdAt: new Date().toISOString() })}\n`,
  );
  const recovered = run("status", "--agent", "codex", "--state", "done", "--task", "Recovered stale lock");
  assert.equal(recovered.status, 0);

  const state = JSON.parse(await readFile(join(bridgeDirectory, "state.json"), "utf8"));
  assert.equal(state.agents.codex.state, "done");
  assert.deepEqual(state.claims.map(({ agent, path }) => ({ agent, path })), [
    { agent: "claude", path: "app/page.tsx" },
  ]);
});
