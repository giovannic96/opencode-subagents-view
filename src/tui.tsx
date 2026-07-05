import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { For, createSignal, Show } from "solid-js"
import { countActiveChildSessions, trackChildSessions } from "./child-sessions-tracker"
import type { ChildSessionRecords } from "./child-sessions-types"

const id = "subagent-view"

// Cached per session id instead of created fresh per render: repeated render
// calls must reuse existing state, not restart it. See README ("A real bug
// this project hit") for why.
const childSessionRecords = new Map<string, () => ChildSessionRecords>()

export function getOrCreateChildSessions(
  api: TuiPluginApi,
  parentSessionID: string,
  onDispose: (fn: () => void) => void,
): () => ChildSessionRecords {
  const cached = childSessionRecords.get(parentSessionID)
  if (cached) return cached

  const [childSessions, setChildSessions] = createSignal<ChildSessionRecords>(new Map())
  const unsubscribe = trackChildSessions(api, parentSessionID, setChildSessions)

  onDispose(() => {
    unsubscribe()
    childSessionRecords.delete(parentSessionID)
  })

  childSessionRecords.set(parentSessionID, childSessions)
  return childSessions
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const childSessions = getOrCreateChildSessions(props.api, props.session_id, props.api.lifecycle.onDispose)
  const childSessionCount = () => countActiveChildSessions(childSessions())
  const childSessionRows = () => Array.from(childSessions().values()).sort((a, b) => a.id.localeCompare(b.id))

  return (
    <Show when={childSessionCount() > 0}>
      <box>
        <text fg={theme().text}>
          <b>Subagents</b> ({childSessionCount()})
        </text>
        <For each={childSessionRows()}>
          {(child) => (
            <text fg={theme().textMuted}>
              - {child.id} ({child.status})
            </text>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350, // after built-in LSP (300), before Todo (400)
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: TuiPluginModule = {
  id,
  tui,
}

export default plugin
