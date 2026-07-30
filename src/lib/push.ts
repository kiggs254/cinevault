import webpush from "web-push";
import { prisma } from "./db";
import { getConfig, saveConfig } from "./config";

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/** VAPID keys, generated + persisted (encrypted) to the DB on first use. */
async function getVapid(): Promise<{ publicKey: string; privateKey: string; subject: string } | null> {
  const cfg = await getConfig();
  let publicKey = cfg.webPush.publicKey;
  let privateKey = cfg.webPush.privateKey;
  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    await saveConfig({ vapidPublicKey: publicKey, vapidPrivateKey: privateKey }).catch(() => {});
  }
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: cfg.webPush.subject };
}

/** Public VAPID key for the browser to subscribe (generates on first call). */
export async function getVapidPublicKey(): Promise<string | null> {
  return (await getVapid())?.publicKey ?? null;
}

interface BrowserSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function savePushSubscription(
  userId: string,
  sub: BrowserSub,
  userAgent?: string,
): Promise<void> {
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) return;
  const ua = userAgent?.slice(0, 300) ?? null;
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua },
    create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: ua },
  });
}

export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
}

/** Whether a member has at least one push device subscribed. */
export async function hasPush(userId: string): Promise<boolean> {
  return (await prisma.pushSubscription.count({ where: { userId } })) > 0;
}

/** Send a push to all of a member's devices. Best-effort; prunes expired subs. */
export async function sendPush(userId: string | null | undefined, payload: PushPayload): Promise<void> {
  if (!userId) return;
  try {
    const subs = await prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;
    const vapid = await getVapid();
    if (!vapid) return;
    const body = JSON.stringify(payload);
    const options = {
      vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
      TTL: 3600,
    };
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            options,
          );
        } catch (e: unknown) {
          const code = (e as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
          }
        }
      }),
    );
  } catch {
    /* best-effort */
  }
}
