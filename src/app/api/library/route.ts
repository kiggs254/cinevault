import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { listObjects, makeS3, presignGet } from "@/lib/storage/s3";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.s3.endpoint || !cfg.s3.bucket) {
    return NextResponse.json({ error: "S3 storage is not configured" }, { status: 400 });
  }

  const s3 = makeS3(cfg.s3);
  const url = new URL(req.url);

  const presign = url.searchParams.get("presign");
  if (presign) {
    try {
      const link = await presignGet(s3, cfg.s3.bucket, presign, 3600);
      return NextResponse.json({ url: link }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 500 });
    }
  }

  const prefix = url.searchParams.get("prefix") ?? "";
  try {
    const entries = await listObjects(s3, cfg.s3.bucket, prefix);
    return NextResponse.json(
      { prefix, bucket: cfg.s3.bucket, publicUrl: cfg.s3.publicUrl ?? null, entries },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
