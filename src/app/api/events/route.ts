import { subscribeToProgress } from "@/lib/events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events stream of realtime download progress + status changes. */
export async function GET(req: Request) {
  const encoder = new TextEncoder();
  let unsub: (() => Promise<void>) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (data: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* stream closed */
        }
      };

      send({ type: "hello" });
      ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* ignore */
        }
      }, 25_000);

      unsub = subscribeToProgress((e) => send(e));

      req.signal.addEventListener("abort", () => {
        if (ping) clearInterval(ping);
        if (unsub) void unsub();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      if (unsub) void unsub();
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
