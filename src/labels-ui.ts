import type { ChildSessionRecordStatus } from "./child-sessions-types"
import type { ChildSession } from "./child-sessions-types"
import type { ChildSessionRecord } from "./child-sessions-types"
import type { ChildSessionEvent } from "./child-sessions-types"
import type { Part } from "@opencode-ai/sdk/v2"

export type ChildSessionStatusTone = "success" | "warning" | "error" | "muted"

export type ChildSessionStatusMeta = {
  icon: string
  tone: ChildSessionStatusTone
}

export const DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH = 72
export const DEFAULT_CHILD_SESSION_ACTIVITY_MAX_LENGTH = 60

export function formatChildSessionLabel(session: ChildSession): string {
  const agent = session.agent ?? "unknown"
  const title = (session.title ?? "Cooking stuff").replace(/\s*\(@[^)]* subagent\)$/u, "")
  return `[${agent}] ${title}`
}

export function getChildSessionDisplayLabel(record: ChildSessionRecord): string {
  return record.activity ?? record.label
}

export function truncateChildSessionLabel(label: string, maxLength = DEFAULT_CHILD_SESSION_LABEL_MAX_LENGTH): string {
  if (label.length <= maxLength) return label
  if (maxLength <= 1) return label.slice(0, maxLength)
  return `${label.slice(0, maxLength - 1)}…`
}

export function getChildStatusMeta(status: ChildSessionRecordStatus): ChildSessionStatusMeta {
  switch (status) {
    case "active":
      return { icon: "●", tone: "success" }
    case "retry":
      return { icon: "◐", tone: "warning" }
    case "error":
      return { icon: "✖", tone: "error" }
    default:
      return { icon: "○", tone: "muted" }
  }
}

function getToolLabel(name: string, input?: Record<string, unknown>): string | undefined {
  const target =
    typeof input?.file === "string"
      ? input.file
      : typeof input?.path === "string"
        ? input.path
        : typeof input?.pattern === "string"
          ? input.pattern
          : typeof input?.command === "string"
            ? input.command
            : typeof input?.tool === "string"
              ? input.tool
              : undefined

  if (name === "read") return target ? `reading ${target}` : undefined
  if (name === "grep" || name === "search" || name === "glob") return target ? `searching ${target}` : undefined
  if (name === "write" || name === "edit") return target ? `editing ${target}` : undefined
  if (name === "shell" || name === "exec") return target ? `running shell: ${target}` : "running shell"
  if (name === "task") return target ? `delegating ${target}` : undefined
  return target ? `${name}: ${target}` : `calling ${name}`
}

function withPrefix(prefix: string, value: string): string {
  const trimmed = value.trim()
  return trimmed ? `${prefix} ${trimmed}` : prefix
}

function snippet(value: string, maxLength = 80): string {
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength - 1)}…`
}

function getPartActivity(part: Part): string | undefined {
  switch (part.type) {
    case "subtask":
      return withPrefix("subtask:", part.description.trim() || part.prompt.trim() || part.agent)
    case "tool":
      switch (part.state.status) {
        case "running":
          return part.state.title ? `${part.tool}: ${part.state.title}` : undefined
        case "completed":
          return `${part.tool}: ${part.state.title}`
        default:
          return getToolLabel(part.tool, part.state.input)
      }
    case "retry":
      return `retrying ${part.attempt}`
    case "text":
      return part.text.trim() ? snippet(part.text) : undefined
    case "agent":
      return `agent: ${part.name}`
    case "patch":
      return part.files.length > 0 ? `editing ${part.files[0]}` : undefined
    default:
      return undefined
  }
}

export function getEventActivity(event: ChildSessionEvent): string | undefined {
  switch (event.type) {
    case "session.next.tool.input.started":
      return `preparing ${event.properties.name}`
    case "session.next.tool.called":
      return getToolLabel(event.properties.tool, event.properties.input)
    case "session.next.retried":
      return `retrying ${event.properties.attempt}`
    case "message.part.updated":
      return getPartActivity(event.properties.part)
    default:
      return undefined
  }
}
