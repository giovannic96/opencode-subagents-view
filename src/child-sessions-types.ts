export type ChildSession = {
  id: string
  parentID?: string
  title?: string
  agent?: string
}

export const CHILD_SESSION_EVENT_TYPES = [
  "session.created",
  "session.updated",
  "session.status",
  "session.idle",
  "session.deleted",
  "session.next.step.ended",
  "session.next.step.failed",
] as const

export type ChildSessionEventType = (typeof CHILD_SESSION_EVENT_TYPES)[number]

export type ChildSessionStatus = {
  type: "idle" | "retry" | "busy"
}

export type ChildSessionEvent =
  | {
      type: "session.created" | "session.updated"
      properties: {
        sessionID: string
        info: ChildSession
      }
    }
  | {
      type: "session.deleted"
      properties: {
        sessionID: string
        info: ChildSession
      }
    }
  | {
      type: "session.status"
      properties: {
        sessionID: string
        status: ChildSessionStatus
      }
    }
  | {
      type: "session.idle"
      properties: {
        sessionID: string
      }
    }
  | {
      type: "session.next.step.ended"
      properties: {
        sessionID: string
      }
    }
  | {
      type: "session.next.step.failed"
      properties: {
        sessionID: string
      }
    }

export type ChildSessionRecordStatus = "active" | "idle"

export type ChildSessionRecord = {
  id: string
  label: string
  status: ChildSessionRecordStatus
}

export type ChildSessionRecords = ReadonlyMap<string, ChildSessionRecord>
