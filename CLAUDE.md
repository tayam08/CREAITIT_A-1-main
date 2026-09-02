# Claude project collaboration

Read `AGENTS.md`, `SAVEPOINT.md`, its linked latest savepoint record, and `AGENT_BRIDGE.md` before changing this project.

For every task in this repository:

1. Run `npm run bridge -- inbox --agent claude` and `npm run bridge -- overview` before acting.
2. Summarize the task with `npm run bridge -- status --agent claude --state working --task "..."`.
3. Claim exact files before edits using `npm run bridge -- claim --agent claude --files path1,path2 --task "..."`.
4. Respect Codex claims. When a claim conflicts, do not edit the file; post a question or feedback event to Codex.
5. Post concise decisions, questions, findings, changed files, and verification results through the bridge.
6. On completion or pause, release claims and set the final state to `done`, `blocked`, or `idle`.

Never put credentials, tokens, account data, hidden reasoning, or full private conversations in bridge messages. Preserve all product and security invariants in `AGENTS.md`.
