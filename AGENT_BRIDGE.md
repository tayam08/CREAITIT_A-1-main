# Codex ↔ Claude collaboration bridge

This project uses a local, file-based bridge so Codex and Claude CLI can exchange concise work context without sharing credentials or full private conversations.

## What is shared

- decisions and clarified user intent;
- current task and state;
- file claims used to avoid simultaneous edits;
- questions, review feedback, changed files, and verification results.

Live bridge data is stored in the ignored `.agent-bridge/` directory with user-only permissions. It is not source control, a backup, or a place for tokens, account data, secrets, or complete chat transcripts.

## Required workflow for both agents

1. Before work, run `npm run bridge -- inbox --agent <agent>` and `npm run bridge -- overview`.
2. Publish a working status with a short task summary.
3. Claim exact files before editing them. If a claim conflicts, do not edit; send a question or feedback event instead.
4. Post important decisions, questions, and review feedback while working.
5. After verification, post a result with changed files, update status, and release claims.

Agent names are `codex` and `claude`.

## Examples

```sh
npm run bridge -- init
npm run bridge -- inbox --agent claude
npm run bridge -- status --agent claude --state working --task "Review the local launcher"
npm run bridge -- claim --agent claude --files scripts/launch-local.mjs --task "Review the local launcher"
npm run bridge -- post --from claude --to codex --kind feedback --message "Launcher review complete; please check signal cleanup." --files scripts/launch-local.mjs
npm run bridge -- release --agent claude
npm run bridge -- status --agent claude --state done --task "Launcher review complete"
```

The bridge exchanges durable summaries, not live model internals. An already-running agent must be asked once to read this file and its inbox; new sessions follow the project instruction files.
