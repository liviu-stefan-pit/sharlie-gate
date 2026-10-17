const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailers", "transfer-encoding", "upgrade", "content-encoding", "content-length"]);

export function forwardHeaders(headers: Headers, extra?: Record<string, string>): Headers {
  const out = new Headers();
  headers.forEach((value, key) => {
    if (!HOP.has(key.toLowerCase())) out.set(key, value);
  });
  if (extra) for (const [key, value] of Object.entries(extra)) out.set(key, value);
  return out;
}

export async function forwardUpstream(url: string, init: RequestInit & { headers: Headers }): Promise<Response> {
  return fetch(url, init);
}
