export interface RouteTarget {
  url: string;
  provider: "anthropic" | "openai" | "custom";
}

export function routePath(pathname: string, bases: {
  anthropic: string;
  openai: string;
  custom: Record<string, string>;
  defaultProvider: "anthropic" | "openai";
}): RouteTarget | undefined {
  if (pathname.startsWith("/anthropic/")) {
    return { url: join(bases.anthropic, pathname.slice("/anthropic".length)), provider: "anthropic" };
  }
  if (pathname.startsWith("/openai/")) {
    return { url: join(bases.openai, pathname.slice("/openai".length)), provider: "openai" };
  }
  const custom = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
  if (custom?.[1]) {
    const base = bases.custom[custom[1]];
    if (!base) return undefined;
    return { url: join(base, custom[2] ?? "/"), provider: "custom" };
  }
  if (pathname.startsWith("/v1/")) {
    const base = bases.defaultProvider === "openai" ? bases.openai : bases.anthropic;
    return { url: join(base, pathname), provider: bases.defaultProvider };
  }
  return undefined;
}

function join(base: string, rest: string): string {
  const root = base.replace(/\/$/, "");
  const path = rest.startsWith("/") ? rest : `/${rest}`;
  return `${root}${path}`;
}

export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.split(":")[0]?.toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}
