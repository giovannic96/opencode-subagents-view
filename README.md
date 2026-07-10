# opencode-subagent-view
A terminal UI plugin for OpenCode that adds a live "Subagents" panel to the session sidebar, showing a colored status icon and label for each tracked child session. Unofficial community project, not affiliated with the OpenCode team.

## Installation

> **Status**: not yet published to npm. Use the "from source" instructions below for now.

### From source (current)

1. Clone this repo somewhere on your machine, e.g.:

   ```bash
   git clone git@github.com:giovannic96/opencode-subagent-view.git ~/repos/personal/opencode-subagent-view
   ```

2. Install its dependencies:

   ```bash
   cd ~/repos/personal/opencode-subagent-view
   npm install
   ```

   This also runs a `postinstall` script (`patch-package`) that patches a Bun-specific module resolution issue in `solid-js` (see [Why there's a patch for solid-js](#why-theres-a-patch-for-solid-js) below). Without it, the panel will compute correctly internally but never actually update on screen.

3. Register it in a **`tui.json`** (or `tui.jsonc`) file, not `opencode.json`. This plugin only exports a `tui` entrypoint, and opencode resolves TUI-kind plugins through a separate config file dedicated to TUI settings, independent from the main `opencode.json`. Use the global one (`~/.config/opencode/tui.json`) so it's available in every project, or a project-level `tui.json` if you only want it there:

   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugin": ["/absolute/path/to/opencode-subagent-view"]
   }
   ```

   Two things worth knowing, both learned the hard way while building this:
   - Dropping this folder into `.opencode/plugins/` (or `~/.config/opencode/plugins/`) will **not** work on its own, since opencode's auto-discovery for that folder only picks up bare `.ts`/`.js` files, not a package-shaped directory like this one.
   - Putting the `plugin` entry in `opencode.json` instead of `tui.json` also will not work: that only affects server-side plugin loading. TUI-kind plugins (like this one) are resolved by a separate config pipeline that reads `tui.json`/`tui.jsonc` specifically.

4. Quit and restart opencode. Config and plugins are only read at startup, so a running session won't pick up the change.

5. Confirm it actually loaded (not just that config accepted it) by opening the command palette (`ctrl+p`) and selecting **Plugins**. Look for `subagent-view` under "External" with a green **active** status.

   Note: `opencode debug info` is **not** a reliable check for this. It only echoes what the config declares, not whether the plugin actually resolved and loaded at runtime, so it can report success even when nothing actually loaded.

### From npm (once published)

Same caveat applies: put this in `tui.json`/`tui.jsonc`, not `opencode.json`.

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-subagent-view"]
}
```

## How it works

This is a plain TUI plugin, not a fork or patch of opencode itself. It hooks into the same `sidebar_content` slot that the built-in Context, LSP, MCP, and Todo sections use, so it renders as just another section in the existing sidebar rather than a separate window or overlay.

> **Status**: being built incrementally, one small, tested, verified-in-a-real-session step at a time. Currently implemented and verified:
> - A "Subagents (N active)" section appears only after the current session spawns its first direct child session (e.g. one spawned via the `task` tool).
> - After that, it stays visible until the session is disposed, even if all tracked children go idle.
> - The section renders one row per tracked child, showing a colored status icon plus a label that truncates to fit the sidebar.
>
> Not yet implemented: current activity and the auto-hide grace period after a subagent finishes. See the repo's commit history for what's landed so far.

### Code layout

- `src/child-sessions-tracker.ts`: session membership logic plus the live session subscription. Plain data in, data out.
- `src/child-sessions-types.ts`: shared child-session and event types.
- `src/tui.tsx`: the only file that touches solid-js (`createSignal`) and JSX, kept as thin as possible on purpose (see "Why all the solid-js code lives in one file" below). Registers the section at `order: 350` in the shared `sidebar_content` slot (built-ins: Context=100, MCP=200, LSP=300, Todo=400, Files=500), placing it right after LSP, before Todo.

### Why all the solid-js code lives in one file

Earlier in the project, `createSignal`/`createEffect` was split across files and ended up with different `solid-js` instances, so updates stopped propagating. The fix was to keep all Solid usage in `src/tui.tsx`. Plain TypeScript modules can stay separate.

### Development

- `npm test` (or `bun test`) runs the test suite. Session-tracking rules and the plugin's reactive wiring are tested together in `tests/child-sessions-tracker.test.ts` using plain mocks and solid-js's `createRoot`, without needing a real opencode instance.
- `npm run typecheck` runs `tsc --noEmit`.

### A real bug this project hit, and how it's guarded against now

An early version of the section re-created state on every render and could trigger a feedback loop. The fix caches state per session id for the plugin lifetime, so later renders reuse the settled state instead of starting over. `tests/tui.test.ts` pins that down.

The current implementation keeps a record for each child session. Active children count toward the sidebar number, idle children stay visible, and deleted children are removed entirely. The section itself stays visible once the first child has appeared, until the session is disposed.

One subtle but important detail: the cache does **not** store the count itself. It stores the function returned by `getOrCreateChildSessionCount`, and that function closes over a Solid signal. The signal changes when `setChildIds(...)` runs, but the cached function stays the same, so every later call to `childSessionCount()` still reads the latest number. That is why caching the function is enough, even though the cache entry itself is only written once.

The full flow is:

1. `View(...)` renders for a specific `session_id`.
2. `getOrCreateChildSessionCount(...)` checks whether that session already has a cached getter.
3. On the first render for that session, it creates a Solid signal with an empty `Set` of child ids.
4. `trackChildSessions(...)` subscribes to live `session.created`, `session.updated`, `session.status`, `session.idle`, `session.deleted`, `session.next.step.ended`, `session.next.step.failed`, `session.next.tool.input.started`, `session.next.tool.called`, `session.next.retried`, and `message.part.updated` events.
5. The live events are handled a little differently:
   - `session.created`: a new direct child session was created. If it belongs to the current parent, it is added as `active` and gets the base label like `[agent] title`.
   - `session.updated`: an existing session changed. If it still belongs to the current parent and is already tracked, it stays in whatever state it already had; if it no longer belongs, it is removed.
   - `session.status`: the session reported a status change. `busy` keeps the child active, `idle` marks it idle, and `retry` marks it retry.
   - `session.idle`: the session explicitly went idle. The child stays in the map but becomes `idle`.
    - `session.next.step.ended`: the child finished its current step. The row stays visible, but the status becomes `idle`.
    - `session.next.step.failed`: the child failed its current step. The row stays visible, but the status becomes `error`.
    - `session.next.tool.input.started`: the child started preparing a tool call. The row only changes if the tool input already contains a target we can show.
    - `session.next.tool.called`: the tool was called. The row activity becomes a concrete summary like `searching src/**/*.ts`, `editing README.md`, or `running shell: bun test` when the input provides a target. If OpenCode does not give us a target, the existing activity stays in place.
    - `session.next.retried`: the session retried. The row activity becomes `retrying N`.
    - `message.part.updated`: a finalized part arrived or changed. The row activity is derived from the part type, for example a raw text snippet for `text`, `glob: src/**/*.ts` for completed tool output, or `subtask: ...` for delegated work.
    - `session.deleted`: the child session was deleted. If its id is tracked, it is removed from the map.
    - Those event names are defined once in `src/child-sessions-types.ts` and the type is derived from that list, so the code does not repeat the union in multiple places.
6. Whenever one of those cases changes the set, `setChildIds(...)` replaces the signal with a new set.
7. Solid notices that `childIds()` changed, so `childSessionCount()` is re-evaluated.
8. The sidebar now shows the updated `Subagents (N active)` value, plus a per-row status icon, the original `[agent] title`, and a second indented line for the current activity when available. If all tracked children are idle, the section stays visible as `Subagents (0 active)` until a new child arrives, at which point old idle rows are cleared and the new run starts fresh.
9. If the same session is rendered again, the cached getter is reused instead of creating a new signal or a new listener.
10. When the plugin/view is being shut down, for example when you quit opencode, close the terminal, or disable/reload the plugin, the `onDispose(...)` callback runs. It calls `unsubscribe()` so the live event listeners stop and the cached entry for that session is removed.
11. That cleanup matters because otherwise the plugin would keep listening to old session events even after the view is gone.

### Real Example

Suppose the current session is `A`.

- At first, there are no live child-session events yet, so the sidebar stays hidden.
- Later, opencode creates a new session `B` with `parentID: "A"`.
- A `session.created` event arrives.
- `updateChildSessionMembership(...)` sees that `B` belongs to `A`, so it adds `B` to the set.
- The count changes from `0` to `1`, and the sidebar shows `Subagents (1 active)`.
- If `B` later becomes idle, the `session.idle` or `session.status` event keeps it in the record map but marks it `idle`, and the section stays visible.
- If every tracked child is idle, the section stays visible as `Subagents (0 active)`.
- When a new child appears after that idle-only state, the old idle rows are cleared so the section shows only the new run.
- If `B` starts text, the second line stays as-is unless OpenCode later gives concrete text to show.
- If `B` calls a tool, the second line shows a concrete summary like `searching src/**/*.ts` or `running shell: bun test` when the tool input has a target, and it stays unchanged when the tool has no target or fails.
- If `B` emits a finalized part, `message.part.updated` refreshes the second line with that concrete summary only when there is real text to show.
- If `B` finishes a step, the `session.next.step.ended` or `session.next.step.failed` event marks it `idle` or `error`, and the section stays visible.
- If OpenCode emits a later `session.updated` for `B`, the plugin keeps it idle instead of reactivating it.
- If `B` is deleted, the `session.deleted` event removes it from the map.
- The count goes back to `0`, but the sidebar stays visible until the session itself is disposed.

### Why there's a patch for solid-js

`solid-js` publishes a conditional `exports` map with a `"node"` condition that points at its server-side rendering build, a one-shot, non-reactive implementation meant for frameworks that render HTML once on a Node.js backend. Bun explicitly supports and matches that `"node"` condition for compatibility with the wider Node ecosystem.

That's the right choice for a typical Node.js backend, but wrong here: this plugin runs inside an interactive terminal UI, not a one-shot server render, and needs the same reactive build (the one `solid-js`'s `"browser"`/default condition points to) that `@opentui/solid` itself expects. Because opencode dynamically imports this plugin's own unbundled `node_modules` at runtime (rather than bundling it ahead of time the way opencode's own internal UI code is built), Bun's normal condition matching kicks in and picks the wrong one.

The symptom, if this isn't patched, is subtle and confusing: `createSignal`, `createEffect`, and `createMemo` all still exist and don't throw, but nothing created with them ever updates after the initial render, because the resolved `solid-js` build's `createEffect` is a literal no-op and its signals don't notify subscribers.

`patches/solid-js+1.9.12.patch` removes that `"node"` condition from `solid-js`'s own `package.json`, applied automatically on install by [`patch-package`](https://github.com/ds300/patch-package) (a standard, widely-used tool for exactly this situation, patching a third-party dependency without forking it). The patch is a plain, five-line diff, reviewable in the file itself. `patch-package` fails the install loudly if a future `solid-js` upgrade makes the patch no longer apply cleanly, rather than silently doing nothing.
