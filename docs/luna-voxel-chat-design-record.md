# LUNA Voxel Chat — design decision record

## Comprehension thesis

The user should understand within three seconds that this is a live LUNA question-and-answer surface, ask from the centered composer, then follow a familiar user-message → assistant-response → follow-up loop without encountering CAD controls.

## Visual thesis

Translate the supplied “Interactive Voxel Space” reference into a quiet conversational field: a restrained ivory canvas, a single floating grayscale voxel cluster, pixel-scale display type, tiny system labels, and lilac/pink accents reserved for human prompts and welcoming language.

## Information architecture

- Empty state: identity → centered question composer → three optional starters.
- Conversation state: lightweight thread metadata → sequential messages → persistent follow-up composer.
- Peripheral state: local model connection at top right; model/plan metadata at the bottom edge.

## Reference and roles

- `Pasted image 20260426190812.png` / `디자인 모음/큐브 여러개.md`
  - Visual structure: sparse edge navigation, centered spatial object, strong negative space.
  - Type: pixel display title contrasted with compact sans labels.
  - Motif and motion: grayscale Three.js voxel cluster responding gently to pointer position.
  - Excluded: portfolio-specific copy, decorative navigation destinations, and cursor takeover.
- ChatGPT interaction grammar
  - Information structure: centered empty-state composer, user bubble, open assistant response, docked follow-up composer.
  - Excluded: account menus, tool marketplace, attachments, and unimplemented controls.

## Key tokens

- Paper `#F5F4EF`; ink `#111111`; lilac `#E9E0F8`; pink `#F7D5EE`; yellow `#F9ED89`.
- Space Grotesk for conversation and metadata; Silkscreen only for the hero identity.
- One ambient three-dimensional motif; motion becomes nearly still once sustained reading starts.

## Two-axis QA result

- Visual/form axis: **4.3 / 5 — pass.** One dominant voxel motif, controlled accent budget, responsive type scaling, reduced-motion support, and the supplied reference's scale/whitespace rhythm are present. The largest remaining gap is that the display font supports only the Latin hero phrase; Korean conversation correctly falls back to the sans text role.
- Information/comprehension axis: **4.6 / 5 — pass.** The empty view has one obvious question entry point; connection feedback is adjacent to the composer; the conversation view preserves sequential multi-turn history and one persistent next action. The largest remaining gap is plain-text rather than full Markdown rendering.
- Three-second result: LUNA identity, question entry, and connection state are immediately visible.
- Thirty-second result: starter prompts, Enter-to-send behavior, streaming response, and new-chat action are discoverable without a separate tutorial.
- Close-read result: user and assistant roles remain visually distinct; long answers use a readable central column; model and plan metadata stay peripheral.
- Critical blocker resolved: all CAD, modular assembly, inspection, and constraint UI was removed from both the source and rendered-output assertions.
- Final gate: **pass** on both axes.

## Open risks

- The hosted HTTPS preview cannot reliably access a local insecure WebSocket bridge; full model use remains a localhost workflow.
- Assistant text is rendered as readable plain text rather than full Markdown in this iteration.
