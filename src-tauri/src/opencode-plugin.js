// EasyIsland: le sessioni di opencode nell'isola.
// Scritto da EasyIsland (Impostazioni → Agenti e chat → opencode), che lo
// riscrive o lo toglie da lì: non modificarlo a mano.
// Passa gli eventi a easyisland-hook.exe e non aspetta mai, tranne per un
// permesso: si può rispondere dall'isola o qui, e se EasyIsland è chiuso
// o non risponde resta tutto come senza plugin.
import { spawn } from "node:child_process";

const HOOK = __HOOK__;

/** Runs the relay with the event on stdin; resolves with what it printed ("" on any error). */
function relay(event, payload, onSpawn) {
  return new Promise((resolve) => {
    let out = "";
    let child;
    try {
      child = spawn(HOOK, [event, "--agent", "opencode"], { stdio: ["pipe", "pipe", "ignore"], windowsHide: true });
    } catch {
      resolve("");
      return;
    }
    onSpawn?.(child);
    child.on("error", () => resolve(""));
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => resolve(out));
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ ...payload, hook_event_name: event }));
  });
}

const promptText = (parts) =>
  (parts ?? []).filter((p) => p?.type === "text" && !p.synthetic).map((p) => p.text).join("\n");

export const EasyIsland = async ({ client, directory, serverUrl }) => {
  const send = (event, data) => void relay(event, { cwd: directory, ...data });
  /** A permission's relay, still waiting for the island: id → process. */
  const waiting = new Map();
  /** A tool's arguments by call, for versions whose tool.execute.after has none. */
  const args = new Map();

  // The island's answer, through whichever API this opencode has.
  async function reply(p, answer) {
    try {
      const r = await client?.postSessionIdPermissionsPermissionId?.({ path: { id: p.sessionID, permissionID: p.id }, body: { response: answer } });
      if (r && !r.error) return;
    } catch {}
    try {
      const r = await client?.permission?.reply?.({ requestID: p.id, reply: answer });
      if (r && !r.error) return;
    } catch {}
    try {
      if (serverUrl) {
        await fetch(new URL(`/permission/${p.id}/reply`, serverUrl), {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: answer }),
        });
      }
    } catch {}
  }

  async function ask(p) {
    if (!p?.id) return;
    const patterns = p.patterns ?? (p.pattern ? [].concat(p.pattern) : []);
    const out = await relay("permission.asked", {
      cwd: directory, session_id: p.sessionID, permission: p.permission ?? p.type,
      patterns, always: p.always ?? [], metadata: p.metadata ?? {},
    }, (child) => waiting.set(p.id, child));
    waiting.delete(p.id);
    let decision = null;
    try {
      decision = JSON.parse(out.trim().split("\n").pop() || "null")?.hookSpecificOutput?.decision ?? null;
    } catch {}
    // No answer from the island: opencode keeps asking in its own window.
    if (!decision) return;
    await reply(p, decision.behavior === "deny" ? "reject" : decision.updatedPermissions ? "always" : "once");
  }

  return {
    event: async ({ event }) => {
      const props = event?.properties ?? {};
      switch (event?.type) {
        case "session.created":
          send("session.created", { session_id: props.info?.id ?? props.sessionID });
          break;
        case "session.deleted":
          send("session.deleted", { session_id: props.info?.id ?? props.sessionID });
          break;
        case "session.idle":
          send("session.idle", { session_id: props.sessionID });
          break;
        case "session.error":
          send("session.error", { session_id: props.sessionID, error: props.error ?? null });
          break;
        case "session.compacted":
          send("session.compacted", { session_id: props.sessionID });
          break;
        case "permission.asked":
        case "permission.updated":
          // Never awaited: opencode goes on, and asks in its window too.
          void ask(props);
          break;
        case "permission.replied": {
          // Answered in opencode: the island stops waiting.
          const id = props.requestID ?? props.permissionID;
          waiting.get(id)?.kill();
          waiting.delete(id);
          break;
        }
      }
    },
    "chat.message": async (input, output) => {
      send("chat.message", { session_id: input?.sessionID, prompt: promptText(output?.parts) });
    },
    "tool.execute.before": async (input, output) => {
      args.set(input?.callID, output?.args ?? {});
      send("tool.execute.before", { session_id: input?.sessionID, tool_name: input?.tool, tool_input: output?.args ?? {} });
    },
    "tool.execute.after": async (input, output) => {
      const toolInput = input?.args ?? args.get(input?.callID) ?? {};
      args.delete(input?.callID);
      send("tool.execute.after", {
        session_id: input?.sessionID, tool_name: input?.tool, tool_input: toolInput,
        tool_response: { stdout: typeof output?.output === "string" ? output.output : "" },
      });
    },
  };
};
