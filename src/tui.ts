import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

const POLL_MS = 2_000
const MAX_ROWS = 8
const NAME_WIDTH = 10
const STATUS_WIDTH = 5
const ELAPSED_WIDTH = 4
const TITLE_WIDTH = 10

type RunStatus = "busy" | "retry"

interface SessionInfo {
  id: string
  parentID?: string
  directory: string
  title: string
  time: { created: number }
}

interface Candidate {
  session: SessionInfo
  status: RunStatus
  created: number
}

interface Row {
  name: string
  status: RunStatus
  elapsed: string
  title: string
}

interface Snapshot {
  rows: Row[]
  more: number
}

function truncate(value: string, width: number): string {
  if (width <= 0) return value
  if (value.length > width) return `${value.slice(0, width - 1)}…`
  return value
}

function fit(value: string, width: number): string {
  return truncate(value, width).padEnd(width, " ")
}

function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.min(Math.floor(minutes / 60), 999)}h`
}

function agentFromTitle(title: string): string | null {
  const match = /\(@([a-z0-9-]+) subagent\)/.exec(title)
  return match ? match[1] : null
}

function resolveAgent(api: TuiPluginApi, session: SessionInfo): string {
  const fromTitle = agentFromTitle(session.title)
  if (fromTitle) return fromTitle
  try {
    const first = api.state.session.messages(session.id)[0]
    const agent = first?.agent
    if (typeof agent === "string" && agent.length > 0) return agent
  } catch {
    // fall through to the placeholder
  }
  return "?"
}

const plugin: TuiPlugin = async (api) => {
  // Use the TUI process's own solid runtime so reactive effects integrate
  // with the host renderer (same approach as built-in sidebar sections).
  const solid = await import("@opentui/solid").catch(() => null)
  if (!solid) return
  const solidjs = await import("solid-js").catch(() => null)
  if (!solidjs || typeof solidjs.createSignal !== "function") return

  const [snap, setSnap] = solidjs.createSignal<Snapshot | null>(null)
  let disposed = false
  let inFlight = false
  let timer: ReturnType<typeof setInterval> | null = null
  const unsubscribes: Array<() => void> = []

  api.slots.register({
    order: 450,
    slots: {
      sidebar_content() {
        return buildSidebar(solid, api, snap)
      },
    },
  })

  const refresh = async () => {
    if (disposed || inFlight) return
    inFlight = true
    try {
      const directory = api.state.path.directory
      const sessions = (await api.client.session.list({ directory })).data ?? []
      const statuses = (await api.client.session.status()).data ?? {}
      const now = Date.now()
      const running: Candidate[] = []

      for (const session of sessions) {
        if (typeof session.parentID !== "string") continue
        if (session.directory !== directory) continue
        const status = statuses[session.id]?.type ?? api.state.session.status(session.id)?.type
        if (status !== "busy" && status !== "retry") continue
        running.push({ session, status, created: session.time.created })
      }

      running.sort((a, b) => a.created - b.created)
      const rows = running.slice(0, MAX_ROWS).map((item) => ({
        name: resolveAgent(api, item.session),
        status: item.status,
        elapsed: formatElapsed(now - item.created),
        title: item.session.title,
      }))

      setSnap({ rows, more: Math.max(0, running.length - MAX_ROWS) })
      api.renderer.requestRender()
    } catch {
      // Best-effort monitor: keep the previous snapshot and stay silent.
    } finally {
      inFlight = false
    }
  }

  void refresh()

  const subscribe = (type: "session.status" | "session.created" | "session.deleted") => {
    try {
      const off = api.event.on(type, () => {
        void refresh()
      })
      if (typeof off === "function") unsubscribes.push(off)
    } catch {
      // The event bus is optional; the interval poll below is the fallback.
    }
  }
  subscribe("session.status")
  subscribe("session.created")
  subscribe("session.deleted")

  timer = setInterval(() => {
    void refresh()
  }, POLL_MS)

  api.lifecycle.onDispose(() => {
    disposed = true
    if (timer) clearInterval(timer)
    for (const off of unsubscribes) {
      try {
        off()
      } catch {
        // best-effort cleanup
      }
    }
    unsubscribes.length = 0
  })
}

/**
 * Builds a reactive sidebar element: the child list is passed to
 * `solid.insert` as an accessor, so it re-evaluates whenever the underlying
 * signals change — updating the on-screen text even while the TUI is idle.
 *
 * The wrapper has no border or padding, so when nothing is running the
 * accessor returns no children and the section renders zero lines.
 */
function buildSidebar(solid: any, api: TuiPluginApi, snap: () => Snapshot | null) {
  const wrapper = solid.createElement("box")
  solid.setProp(wrapper, "flexDirection", "column")

  const children = () => {
    const s = snap()
    const t = api.theme.current
    const out: any[] = []
    if (!s || s.rows.length === 0) return out

    // Built inside the accessor so border/theme props are re-applied on
    // every rebuild (theme switches included).
    const box = solid.createElement("box")
    solid.setProp(box, "borderStyle", "single")
    solid.setProp(box, "borderColor", t.borderSubtle)
    solid.setProp(box, "flexDirection", "column")
    solid.setProp(box, "padding", 1)

    const title = solid.createElement("text")
    solid.setProp(title, "wrapMode", "none")
    solid.setProp(title, "fg", t.info)
    const bold = solid.createElement("b")
    solid.insert(bold, "Subagents")
    solid.insert(title, bold)
    solid.insert(box, title)

    for (const row of s.rows) {
      const line = solid.createElement("text")
      solid.setProp(line, "wrapMode", "none")

      const nameSpan = solid.createElement("span")
      solid.setProp(nameSpan, "style", { fg: t.text })
      solid.insert(nameSpan, fit(row.name, NAME_WIDTH))
      solid.insert(line, nameSpan)

      const statusSpan = solid.createElement("span")
      solid.setProp(statusSpan, "style", { fg: row.status === "retry" ? t.warning : t.accent })
      solid.insert(statusSpan, ` ${fit(row.status, STATUS_WIDTH)}`)
      solid.insert(line, statusSpan)

      const elapsedSpan = solid.createElement("span")
      solid.setProp(elapsedSpan, "style", { fg: t.textMuted })
      solid.insert(elapsedSpan, ` ${fit(row.elapsed, ELAPSED_WIDTH)}`)
      solid.insert(line, elapsedSpan)

      const titleSpan = solid.createElement("span")
      solid.setProp(titleSpan, "style", { fg: t.textMuted })
      solid.insert(titleSpan, ` ${truncate(row.title, TITLE_WIDTH)}`)
      solid.insert(line, titleSpan)

      solid.insert(box, line)
    }

    if (s.more > 0) {
      const more = solid.createElement("text")
      solid.setProp(more, "wrapMode", "none")
      solid.setProp(more, "fg", t.textMuted)
      solid.insert(more, `+${s.more} more`)
      solid.insert(box, more)
    }

    out.push(box)
    return out
  }

  // Pass an accessor: solid's insert tracks the signals read inside and
  // re-runs it on change, replacing the rendered children.
  solid.insert(wrapper, () => children())
  return wrapper
}

export default {
  id: "subagents-tui",
  tui: plugin,
} as const
