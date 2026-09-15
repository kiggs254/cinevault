import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getStorage } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = await getConfig();
  const storage = getStorage(cfg);
  if (storage.kind === "s3" && (!cfg.s3.endpoint || !cfg.s3.bucket)) {
    return NextResponse.json({ error: "S3 storage is not configured" }, { status: 400 });
  }

  const url = new URL(req.url);

  const presign = url.searchParams.get("presign");
  if (presign) {
    try {
      const link = await storage.getUrl(presign, 3600);
      return NextResponse.json({ url: link }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const prefix = url.searchParams.get("prefix") ?? "";
  try {
    const entries = await storage.listObjects(prefix);
    return NextResponse.json(
      {
        prefix,
        bucket: storage.kind === "s3" ? cfg.s3.bucket : null,
        publicUrl: storage.kind === "s3" ? cfg.s3.publicUrl ?? null : null,
        entries,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
