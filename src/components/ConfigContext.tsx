"use client";
import { createContext, useContext, type ReactNode } from "react";
import type { AppConfig } from "@/lib/types";
const Ctx = createContext<AppConfig | null>(null);
export function ConfigProvider({ config, children }: { config: AppConfig; children: ReactNode }) {
  return <Ctx.Provider value={config}>{children}</Ctx.Provider>;
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
