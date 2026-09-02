# Project continuity

Before changing this project, read `SAVEPOINT.md` and the savepoint record it links to.

Preserve these invariants unless the user explicitly changes the product direction:

- The product identity is `면접용_로컬_챗_v1` (`interview-local-chat-v1` in ASCII-only metadata).
- The primary route is `/logo-concept`, including the final 360-degree metallic CREAI+IT emblem with front and back treatment.
- GPT-5.6 Luna remains explicitly pinned; do not silently fall back to another model.
- Every recipient signs in with their own ChatGPT account. Never commit credentials, tokens, or shared API keys.
- All services stay loopback-only. Keep app-server capability-token authentication and browser Origin validation intact.
- This repository is a local interview/demo application, not a public hosted service.

After material changes, run `npm test`, `npm run lint`, and refresh the savepoint if the milestone has changed.

# Codex ↔ Claude collaboration

Before project work, read `AGENT_BRIDGE.md`, then run `npm run bridge -- inbox --agent codex` and `npm run bridge -- overview`.

- Set Codex status to `working` with a concise task summary.
- Claim exact files before editing and respect Claude's claims.
- If a claim conflicts, do not edit the file; post a question or feedback event to Claude.
- Share only concise decisions, questions, changed files, and verification results—never credentials, tokens, hidden reasoning, or full private conversations.
- On completion or pause, post the result, release claims, and set the final state.
