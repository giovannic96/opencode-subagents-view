import {
  CHILD_SESSION_EVENT_TYPES,
  updateChildSessionMembership,
  type ChildSessionEvent,
} from "./session-children"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

function applyChildSessionEvent(
  parentSessionID: string,
  applyUpdate: (reducer: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
): (event: ChildSessionEvent) => void {
  return (event) => {
    applyUpdate((current) => updateChildSessionMembership(current, parentSessionID, event))
  }
}

/**
 * Subscribes to live session events so the child-id set stays in sync.
 *
 * Returns an unsubscribe function.
 */
export function trackChildSessions(
  api: TuiPluginApi,
  parentSessionID: string,
  applyUpdate: (reducer: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
): () => void {
  const handleChildSessionEvent = applyChildSessionEvent(parentSessionID, applyUpdate)
  const unsubscribeAll = CHILD_SESSION_EVENT_TYPES.map((type) => api.event.on(type, handleChildSessionEvent))

  return () => {
    for (const unsubscribe of unsubscribeAll) unsubscribe()
  }
}
