import { randomUUID } from "node:crypto";
import type { Source } from "../shared/types";
export const instagramReady = () =>
  !!(
    process.env.INSTAGRAM_APP_ID &&
    process.env.INSTAGRAM_APP_SECRET &&
    /^[a-f0-9]{64}$/i.test(process.env.TOKEN_ENCRYPTION_KEY || "")
  );
export const redirectUri = () =>
  process.env.INSTAGRAM_REDIRECT_URI ||
  `${process.env.PUBLIC_URL || "http://localhost:3000"}/api/instagram/callback`;
async function request(url: string, token: string) {
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  });
  const data = (await r.json()) as any;
  if (!r.ok || data.error)
    throw new Error("Instagram could not read this field.");
  return data;
}
export async function exchange(code: string) {
  const form = new URLSearchParams({
    client_id: process.env.INSTAGRAM_APP_ID!,
    client_secret: process.env.INSTAGRAM_APP_SECRET!,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  const r = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(10000),
  });
  const data = (await r.json()) as any;
  const item = data.data?.[0] || data;
  if (!r.ok || !item.access_token)
    throw new Error(
      "Instagram authorization failed. Check app setup and account eligibility.",
    );
  return {
    token: item.access_token as string,
    expiresIn: Math.min(Number(item.expires_in) || 3600, 3600),
  };
}
export async function importProfile(token: string) {
  const base = `https://graph.instagram.com/${process.env.INSTAGRAM_GRAPH_VERSION || "v25.0"}`;
  const identity = await request(`${base}/me?fields=user_id,username`, token);
  if (!identity.user_id && !identity.id)
    throw new Error("No eligible Instagram account was returned.");
  const sources: Source[] = [];
  const available: string[] = [];
  const unavailable: string[] = [];
  for (const field of ["account_type", "biography"]) {
    try {
      const data = await request(`${base}/me?fields=${field}`, token);
      if (
        field === "account_type" &&
        data[field] &&
        !/business|creator/i.test(data[field])
      )
        throw new Error("Only Business or Creator accounts are supported.");
      if (data[field]) {
        available.push(field);
        if (field === "biography")
          sources.push({
            id: randomUUID(),
            kind: "bio",
            text: String(data[field]).slice(0, 4000),
          });
      } else unavailable.push(field);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Only Business"))
        throw error;
      unavailable.push(field);
    }
  }
  try {
    const media = await request(`${base}/me/media?fields=id&limit=12`, token);
    for (const item of (media.data || []).slice(0, 12)) {
      try {
        const post = await request(
          `${base}/${encodeURIComponent(item.id)}?fields=caption`,
          token,
        );
        if (post.caption)
          sources.push({
            id: randomUUID(),
            kind: "caption",
            text: String(post.caption).slice(0, 4000),
          });
      } catch {
        unavailable.push("caption");
      }
    }
    if (sources.some((s) => s.kind === "caption")) available.push("caption");
  } catch {
    unavailable.push("media");
  }
  return {
    sources,
    available,
    unavailable: [...new Set(unavailable)],
    username: identity.username,
  };
}
