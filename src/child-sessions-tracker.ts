import type {
  ChildSession,
  ChildSessionEvent,
  ChildSessionEventType,
  ChildSessionRecordStatus,
  ChildSessionRecords,
  ChildSessionStatus,
} from "./child-sessions-types"
import { CHILD_SESSION_EVENT_TYPES } from "./child-sessions-types"
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { formatChildSessionLabel, getEventActivity } from "./labels-ui"

export function isChildOf(session: ChildSession, parentSessionID: string): boolean {
  return session.parentID === parentSessionID
}

function toRecordStatus(sessionStatus: ChildSessionStatus["type"]): ChildSessionRecordStatus {
  if (sessionStatus === "idle") return "idle"
  if (sessionStatus === "retry") return "retry"
  return "active"
}

function hasChildStatus(records: ChildSessionRecords, status: ChildSessionRecordStatus): boolean {
  for (const record of records.values()) {
    if (record.status === status) return true
  }
  return false
}

function dropIdleChildren(records: ChildSessionRecords): ChildSessionRecords {
  if (!hasChildStatus(records, "idle")) return records

  const next = new Map(records)
  for (const [sessionID, record] of records) {
    if (record.status === "idle") next.delete(sessionID)
  }
  return next
}

function addOrIgnoreChild(
  records: ChildSessionRecords,
  parentSessionID: string,
  session: ChildSession,
): ChildSessionRecords {
  if (!isChildOf(session, parentSessionID) || records.has(session.id)) return records

  const baseRecords = hasChildStatus(records, "active") ? records : dropIdleChildren(records)
  const next = new Map(baseRecords)
  next.set(session.id, { id: session.id, label: formatChildSessionLabel(session), status: "active" })
  return next
}

function updateChildActivityLabel(records: ChildSessionRecords, sessionID: string, activity?: string): ChildSessionRecords {
  const record = records.get(sessionID)
  if (!record || record.status !== "active") return records

  if (!activity?.trim()) return records

  const nextActivity = activity.trim()
  if (record.activity === nextActivity) return records

  const next = new Map(records)
  next.set(sessionID, { ...record, activity: nextActivity })
  return next
}

function removeChild(records: ChildSessionRecords, sessionID: string): ChildSessionRecords {
  if (!records.has(sessionID)) return records

  const next = new Map(records)
  next.delete(sessionID)
  return next
}

function setChildStatus(
  records: ChildSessionRecords,
  sessionID: string,
  status: ChildSessionRecordStatus,
): ChildSessionRecords {
  const record = records.get(sessionID)
  if (!record || record.status === status) return records

  const next = new Map(records)
  next.set(sessionID, { id: record.id, label: record.label, status })
  return next
}

/**
 * Update the current child-session records from one live session event.
 *
 * - `session.created` adds a matching child as active.
 * - `session.updated` removes a child that no longer belongs to the parent.
 *   Otherwise it leaves the current record unchanged.
 * - `session.status` and `session.idle` keep the child in the map and update
 *   its status to `idle` or `active`.
 * - `session.next.step.ended` and `session.next.step.failed` mark a tracked
 *   child idle.
 * - `session.deleted` removes the child from the map entirely.
 * - If the event does not change anything, return the same map reference so
 *   Solid can skip a pointless update.
 */
export function updateChildSessionRecords(
  records: ChildSessionRecords,
  parentSessionID: string,
  event: ChildSessionEvent,
): ChildSessionRecords {
  switch (event.type) {
    case "session.deleted": {
      return removeChild(records, event.properties.info.id)
    }

    case "session.idle":
    case "session.status": {
      const nextStatus = event.type === "session.idle" ? "idle" : toRecordStatus(event.properties.status.type)
      const next = setChildStatus(records, event.properties.sessionID, nextStatus)
      if (next === records) return records

      const record = next.get(event.properties.sessionID)
      if (!record) return next

      const updated = new Map(next)
      updated.set(event.properties.sessionID, { ...record, activity: undefined })
      return updated
    }

    case "session.next.step.ended":
    case "session.next.step.failed": {
      const next = setChildStatus(records, event.properties.sessionID, event.type === "session.next.step.failed" ? "error" : "idle")
      if (next === records) return records

      const record = next.get(event.properties.sessionID)
      if (!record) return next

      const updated = new Map(next)
      updated.set(event.properties.sessionID, { ...record, activity: undefined })
      return updated
    }

    case "session.next.tool.input.started":
    case "session.next.tool.called":
    case "session.next.retried":
    case "message.part.updated": {
      const eventActivity = getEventActivity(event)
      return eventActivity ? updateChildActivityLabel(records, event.properties.sessionID, eventActivity) : records
    }

    case "session.created":
    case "session.updated": {
      const { info } = event.properties
      return isChildOf(info, parentSessionID) ? addOrIgnoreChild(records, parentSessionID, info) : removeChild(records, info.id)
    }

    default:
      return records
  }
}

export function countActiveChildSessions(records: ChildSessionRecords): number {
  let count = 0
  for (const record of records.values()) {
    if (record.status === "active") count += 1
  }
  return count
}

function applyChildSessionEvent(
  parentSessionID: string,
  applyUpdate: (reducer: (current: ChildSessionRecords) => ChildSessionRecords) => void,
): (event: ChildSessionEvent) => void {
  return (event) => {
    applyUpdate((current) => updateChildSessionRecords(current, parentSessionID, event))
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
  applyUpdate: (reducer: (current: ChildSessionRecords) => ChildSessionRecords) => void,
): () => void {
  const handleChildSessionEvent = applyChildSessionEvent(parentSessionID, applyUpdate)

  const unsubscribeAll = CHILD_SESSION_EVENT_TYPES.map((type: ChildSessionEventType) => api.event.on(type, handleChildSessionEvent))

  return () => {
    for (const unsubscribe of unsubscribeAll) unsubscribe()
  }
}
