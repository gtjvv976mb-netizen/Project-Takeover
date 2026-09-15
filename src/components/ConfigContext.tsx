"use client";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { AppConfig } from "@/lib/types";
import { SITE_URL } from "@/lib/site";
const Ctx = createContext<AppConfig | null>(null);

/**
 * `web3.js` needs an absolute URL, and the default RPC endpoint is this site's own
 * `/api/rpc` — deliberately relative, so a preview deploy and a laptop each talk to their
 * own server. The browser is the only place that knows which origin that is, so this is
 * where the two are put together. An endpoint configured explicitly is already absolute
 * and passes straight through.
 *
 * The server render matters too. `new Connection("/api/rpc")` throws — web3.js refuses a
 * URL that does not start with http — and that throw happened inside the layout, so every
 * page went out as a 500 with React quietly recovering in the browser. The recovery is
 * what hid it: the page looked fine, but an inline script React re-creates on the client
 * never runs, so the theme script was present and inert and dark mode stopped working.
 * On the server the site's own public URL stands in; nothing is fetched through it during
 * a render, so it only has to be well-formed.
 */
export function resolveRpcUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === "undefined") return new URL(url, SITE_URL).toString();
  return new URL(url, window.location.origin).toString();
}

export function ConfigProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  const resolved = useMemo(() => ({ ...config, rpcUrl: resolveRpcUrl(config.rpcUrl) }), [config]);
  return <Ctx.Provider value={resolved}>{children}</Ctx.Provider>;
}
export function useConfig(): AppConfig {
  const c = useContext(Ctx);
  if (!c) throw new Error("ConfigProvider missing");
  return c;
}
export function explorerUrl(cfg: AppConfig, kind: "tx" | "address", value: string) {
  const cluster = cfg.network === "mainnet-beta" ? "" : `?cluster=${cfg.network}`;
  return `https://solscan.io/${kind === "tx" ? "tx" : "account"}/${value}${cluster}`;
}
