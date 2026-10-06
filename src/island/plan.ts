// The agent's plan ("2/4 · Aggiorno i test"), rebuilt from the tool calls that
// write it, read on PreToolUse (the input is the plan; no response needed):
//   - Claude Code: TodoWrite { todos: [{ content, status, activeForm }] }, the
//     whole list every time; or TaskCreate { subject, activeForm } and
//     TaskUpdate { taskId, status, subject }, one task at a time;
//   - Codex: update_plan { plan: [{ step, status }] };
//   - Gemini CLI: write_todos { todos: [{ description, status }] }.

export type PlanStatus = "pending" | "in_progress" | "completed";

export interface PlanItem {
  id: string;
  text: string;
  /** What it says while being done ("Aggiorno i test"); the text otherwise. */
  active: string;
  status: PlanStatus;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function status(v: unknown): PlanStatus | null {
  const s = str(v).toLowerCase();
  if (s === "completed" || s === "done") return "completed";
  if (s === "in_progress" || s === "in-progress" || s === "active") return "in_progress";
  if (s === "pending" || s === "todo" || s === "") return "pending";
  return null; // cancelled, deleted…: not part of the plan any more
}

/** A whole list: [{ <textKey>, status, activeForm? }]. */
function list(raw: unknown, textKey: string): PlanItem[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: PlanItem[] = [];
  raw.forEach((x, i) => {
    if (!x || typeof x !== "object") return;
    const r = x as Record<string, unknown>;
    const text = str(r[textKey]);
    const st = status(r.status);
    if (!text || !st) return;
    out.push({ id: String(i + 1), text, active: str(r.activeForm) || text, status: st });
  });
  return out;
}

/** The plan after this tool call, or undefined when the call does not touch it. */
export function applyPlanTool(plan: PlanItem[] | undefined, tool: string, input: Record<string, unknown>): PlanItem[] | undefined {
  switch (tool) {
    case "TodoWrite":
      return list(input.todos, "content");
    case "write_todos":
      return list(input.todos, "description");
    case "update_plan":
      return list(input.plan, "step");
    case "TaskCreate": {
      const text = str(input.subject) || str(input.description);
      if (!text) return undefined;
      const items = plan ?? [];
      // Claude Code numbers tasks 1, 2, 3… in its reply, which the hook never
      // sees: the same numbering is rebuilt here.
      const next = items.reduce((n, x) => Math.max(n, Number(x.id) || 0), 0) + 1;
      return [...items, { id: String(next), text, active: str(input.activeForm) || text, status: "pending" }];
    }
    case "TaskUpdate": {
      const id = str(input.taskId) || (typeof input.taskId === "number" ? String(input.taskId) : "");
      if (!plan || !id) return undefined;
      return plan.flatMap((x) => {
        if (x.id !== id) return [x];
        const st = input.status === undefined ? x.status : status(input.status);
        if (!st) return [];
        const text = str(input.subject) || x.text;
        return [{ ...x, text, active: str(input.activeForm) || (text !== x.text ? text : x.active), status: st }];
      });
    }
    default:
      return undefined;
  }
}

export interface PlanSummary {
  done: number;
  total: number;
  /** The task being done now, else the next one to do; null once all are done. */
  current: string | null;
}

export function planSummary(plan: PlanItem[] | undefined): PlanSummary | null {
  if (!plan?.length) return null;
  const done = plan.filter((x) => x.status === "completed").length;
  const now = plan.find((x) => x.status === "in_progress") ?? plan.find((x) => x.status === "pending");
  return { done, total: plan.length, current: now ? (now.status === "in_progress" ? now.active : now.text) : null };
}

/** The ticker step for a plan update: "Piano · Aggiorno i test" or "Piano · tutto fatto". */
export function planStep(plan: PlanItem[]): string {
  const s = planSummary(plan);
  if (!s) return "Piano";
  return s.current ? `Piano · ${s.current}` : `Piano · tutto fatto (${s.done}/${s.total})`;
}

/** The plan as a list, for the tooltip of "2/4". */
export function planText(plan: PlanItem[] | undefined): string {
  return (plan ?? []).map((x) => `${x.status === "completed" ? "✓" : x.status === "in_progress" ? "▸" : "·"} ${x.text}`).join("\n");
}
