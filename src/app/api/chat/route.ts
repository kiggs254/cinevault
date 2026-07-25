import { runAgent, type AgentMessage } from "@/lib/llm/agent";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await rateLimit(`chat:${clientIp(req)}`, 30, 60))) {
    return new Response(JSON.stringify({ error: "Rate limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const body = (await req.json().catch(() => ({}))) as { messages?: unknown };
  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: AgentMessage[] = raw
    .filter(
      (m): m is AgentMessage =>
        !!m &&
        typeof m === "object" &&
        ((m as AgentMessage).role === "user" || (m as AgentMessage).role === "assistant") &&
        typeof (m as AgentMessage).content === "string",
    )
    .slice(-20)
    .map((m) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          /* closed */
        }
      };
      try {
        await runAgent(messages, send);
      } catch (e) {
        send({ type: "error", message: (e as Error).message });
        send({ type: "done" });
      }
      try {
        controller.close();
      } catch {
        /* already closed */
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
