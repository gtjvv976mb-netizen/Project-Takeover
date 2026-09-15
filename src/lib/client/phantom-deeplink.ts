"use client";
/**
 * Phantom on a phone, as a Wallet Standard wallet.
 *
 * Safari on an iPhone has no wallet extension, so the site's "Select Wallet" list would
 * be empty there. This registers a wallet named Phantom that speaks Phantom's deep-link
 * protocol instead: connecting or signing opens the Phantom app, the person approves,
 * and Phantom sends the answer back to this site at /wallet/return/<id>.
 *
 * The awkward part is where that answer lands. iOS opens the return link in a *new*
 * Safari tab, not the one that asked, so the tab holding the half-finished purchase never
 * sees the URL. What both tabs do share is localStorage. So a request is written there
 * before Phantom opens; the return tab decrypts the reply and writes it beside the
 * request; and the asking tab, which kept its promise pending, notices — through the
 * storage event, and by re-checking whenever it becomes visible again — and carries on
 * exactly where it was, form state and all. The return tab's only job is to say
 * "signed, switch back".
 *
 * Nothing is sent to the network from the return tab. A signed transaction that nobody
 * picks up (the asking tab was closed) simply expires unsent, so retrying is always safe.
 *
 * A home-screen app cannot use any of this: Apple sends the return link to Safari, whose
 * storage the installed app does not share. That is a platform rule, so the wallet is not
 * offered there and the banner explains why.
 */
import bs58 from "bs58";
import {
  connectUrl, decryptPayload, describePhantomError, methodUrl, newEncryptionKeys, sessionLost,
  sharedSecret, type Cluster, type DeeplinkMethod,
} from "./phantom-deeplink-core";

export const PHANTOM_WALLET_NAME = "Phantom";
const SESSION_KEY = "takeover-phantom-session";
const REQ_PREFIX = "takeover-phantom-req:";
/** How long the asking tab waits, and how long a reply is kept for it. */
const REQUEST_TTL = 10 * 60_000;

/* ------------------------------------------------------------------ storage */

type Session = {
  dappPublicKey: string;
  dappSecretKey: string;
  phantomPublicKey: string;
  session: string;
  publicKey: string;
};

type Rec = {
  id: string;
  method: DeeplinkMethod;
  /** Where the person was, so the return tab can offer the way back. */
  back: string;
  url: string;
  createdAt: number;
  /** Only while a connect is in flight; moves into the session once Phantom answers. */
  dappPublicKey?: string;
  dappSecretKey?: string;
  status: "pending" | "done" | "picked" | "error" | "cancelled";
  result?: unknown;
  error?: string;
};

function read<T>(key: string): T | null {
  try { const raw = localStorage.getItem(key); return raw ? (JSON.parse(raw) as T) : null; } catch { return null; }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode: the flow will time out honestly */ }
}
function remove(key: string) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const readSession = () => read<Session>(SESSION_KEY);
const writeSession = (s: Session) => write(SESSION_KEY, s);
const clearSession = () => remove(SESSION_KEY);
const readRec = (id: string) => read<Rec>(REQ_PREFIX + id);
const writeRec = (r: Rec) => write(REQ_PREFIX + r.id, r);

/** Replies hold signatures; none should outlive the ten minutes a tab would wait for it. */
function sweepRecords() {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(REQ_PREFIX)) continue;
      const rec = read<Rec>(key);
      if (!rec || Date.now() - rec.createdAt > REQUEST_TTL) stale.push(key);
    }
    stale.forEach(remove);
  } catch { /* ignore */ }
}

/* ------------------------------------------------------------------- device */

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function isMobile(): boolean {
  return isIOS() || /Android/i.test(navigator.userAgent);
}
export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);
}
/** Phantom's own in-app browser injects a provider; there the extension path just works. */
export function inPhantomBrowser(): boolean {
  const w = window as { phantom?: { solana?: { isPhantom?: boolean } }; solana?: { isPhantom?: boolean } };
  return !!w.phantom?.solana?.isPhantom || !!w.solana?.isPhantom || /Phantom/i.test(navigator.userAgent);
}
export function deeplinkAvailable(): boolean {
  return isMobile() && !inPhantomBrowser() && !isStandalone();
}

/* ---------------------------------------------------------- the pending request */

export type Pending = { id: string; method: DeeplinkMethod; url: string } | null;
let pending: Pending = null;
const pendingSubs = new Set<() => void>();
function setPending(p: Pending) { pending = p; pendingSubs.forEach((f) => f()); }
export const subscribePending = (f: () => void) => { pendingSubs.add(f); return () => { pendingSubs.delete(f); }; };
export const getPending = () => pending;

/** Phantom did not open, or was closed: send the same link again. */
export function reopenPending() { if (pending) window.location.href = pending.url; }
export function cancelPending() {
  if (!pending) return;
  const rec = readRec(pending.id);
  if (rec && rec.status === "pending") writeRec({ ...rec, status: "cancelled" });
  waiters.get(pending.id)?.();
}

const waiters = new Map<string, () => void>();
/** Whether this page has opened a Phantom link in its lifetime; see `disconnect`. */
let hopped = false;

function waitFor<T>(id: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const off: (() => void)[] = [];
    const finish = (fn: () => void) => { off.forEach((f) => f()); waiters.delete(id); fn(); };
    const check = () => {
      const rec = readRec(id);
      if (!rec) return finish(() => reject(new Error("The Phantom request was lost. Try again.")));
      if (rec.status === "done") { writeRec({ ...rec, status: "picked" }); return finish(() => resolve(rec.result as T)); }
      if (rec.status === "picked") return finish(() => resolve(rec.result as T));
      if (rec.status === "error") return finish(() => reject(new Error(rec.error ?? "Phantom returned an error.")));
      if (rec.status === "cancelled") return finish(() => reject(new Error("Cancelled. Nothing was sent.")));
      if (Date.now() - rec.createdAt > REQUEST_TTL) {
        writeRec({ ...rec, status: "cancelled" });
        return finish(() => reject(new Error("Phantom did not answer within ten minutes. Nothing was sent — try again.")));
      }
    };
    waiters.set(id, check);
    // The storage event is the fast path: it fires here the moment the return tab writes.
    // The rest cover iOS freezing this tab in the background and thawing it later.
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === REQ_PREFIX + id) check(); };
    window.addEventListener("storage", onStorage);
    off.push(() => window.removeEventListener("storage", onStorage));
    document.addEventListener("visibilitychange", check);
    off.push(() => document.removeEventListener("visibilitychange", check));
    for (const ev of ["focus", "pageshow"] as const) {
      window.addEventListener(ev, check);
      off.push(() => window.removeEventListener(ev, check));
    }
    const timer = setInterval(check, 1000);
    off.push(() => clearInterval(timer));
    check();
  });
}

function randomId(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return bs58.encode(b);
}
const returnUrl = (id: string) => `${window.location.origin}/wallet/return/${id}`;
const here = () => window.location.pathname + window.location.search + window.location.hash;

async function perform<T>(method: DeeplinkMethod, build: (id: string) => Pick<Rec, "url" | "dappPublicKey" | "dappSecretKey">): Promise<T> {
  if (pending) throw new Error("Finish the Phantom request that is already open first.");
  const id = randomId();
  const built = build(id);
  writeRec({ id, method, back: here(), createdAt: Date.now(), status: "pending", ...built });
  setPending({ id, method, url: built.url });
  try {
    // A universal link: iOS hands it to the Phantom app and leaves this page where it is.
    hopped = true;
    window.location.href = built.url;
    return await waitFor<T>(id);
  } finally {
    setPending(null);
  }
}

async function signed<T>(method: Exclude<DeeplinkMethod, "connect">, payload: Record<string, unknown>): Promise<T> {
  const s = readSession();
  if (!s) throw new Error("Connect Phantom first.");
  const shared = sharedSecret(s.phantomPublicKey, s.dappSecretKey);
  return perform<T>(method, (id) => ({
    url: methodUrl(method, { dappPublicKey: s.dappPublicKey, redirect: returnUrl(id), shared, payload: { ...payload, session: s.session } }),
  }));
}

/* ------------------------------------------------------------ the return tab */

export type ReturnOutcome =
  | { kind: "expired" }
  | { kind: "connected"; back: string }
  | { kind: "signed"; method: DeeplinkMethod; back: string }
  | { kind: "error"; message: string; back: string };

/**
 * Runs in the tab Phantom opened. Decrypts the reply, files it beside the request so the
 * asking tab can pick it up, and says what to show. Safe to call twice: a reload of the
 * return page reports what already happened rather than doing it again.
 */
export function completeReturn(id: string, params: URLSearchParams): ReturnOutcome {
  const rec = readRec(id);
  if (!rec) return { kind: "expired" };
  if (rec.status === "error") return { kind: "error", message: rec.error ?? "Phantom returned an error.", back: rec.back };
  if (rec.status === "cancelled") return { kind: "error", message: "This request was cancelled.", back: rec.back };
  if (rec.status !== "pending") {
    return rec.method === "connect" ? { kind: "connected", back: rec.back } : { kind: "signed", method: rec.method, back: rec.back };
  }

  const fail = (message: string): ReturnOutcome => {
    writeRec({ ...rec, dappSecretKey: undefined, status: "error", error: message });
    return { kind: "error", message, back: rec.back };
  };

  const code = params.get("errorCode");
  const errorMessage = params.get("errorMessage");
  if (code || errorMessage) {
    if (sessionLost(code, errorMessage)) clearSession();
    return fail(describePhantomError(code, errorMessage));
  }
  const nonce = params.get("nonce");
  const data = params.get("data");
  if (!nonce || !data) return fail("Phantom came back without an answer. Try again.");

  try {
    if (rec.method === "connect") {
      const phantomPublicKey = params.get("phantom_encryption_public_key");
      if (!phantomPublicKey || !rec.dappSecretKey || !rec.dappPublicKey) return fail("The connection reply was incomplete. Try again.");
      const shared = sharedSecret(phantomPublicKey, rec.dappSecretKey);
      const reply = decryptPayload<{ public_key: string; session: string }>(data, nonce, shared);
      writeSession({ dappPublicKey: rec.dappPublicKey, dappSecretKey: rec.dappSecretKey, phantomPublicKey, session: reply.session, publicKey: reply.public_key });
      writeRec({ ...rec, dappSecretKey: undefined, status: "done", result: { publicKey: reply.public_key } });
      return { kind: "connected", back: rec.back };
    }
    const s = readSession();
    if (!s) return fail("This browser has no Phantom session. Connect again.");
    const result = decryptPayload<Record<string, unknown>>(data, nonce, sharedSecret(s.phantomPublicKey, s.dappSecretKey));
    writeRec({ ...rec, status: "done", result });
    return { kind: "signed", method: rec.method, back: rec.back };
  } catch (e) {
    return fail((e as Error).message);
  }
}

/** Has the asking tab taken the reply yet? The return page shows this so people know they can leave. */
export function returnPicked(id: string): boolean {
  return readRec(id)?.status === "picked";
}

/* ---------------------------------------------------------------- the wallet */

type Account = {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
  label?: string;
  icon?: string;
};

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#AB9FF2"/><path d="M32 14c-10.5 0-19 8.3-19 18.6V46a3 3 0 0 0 5 2.2l3-2.7 3 2.7a3 3 0 0 0 4 0l3-2.7 3 2.7a3 3 0 0 0 4 0l3-2.7 3 2.7a3 3 0 0 0 5-2.2V32.6C51 22.3 42.5 14 32 14z" fill="#fff"/><circle cx="25" cy="31" r="3" fill="#AB9FF2"/><circle cx="39" cy="31" r="3" fill="#AB9FF2"/></svg>';
const ICON = `data:image/svg+xml;base64,${typeof btoa === "function" ? btoa(SVG) : ""}` as const;
const ACCOUNT_FEATURES = ["solana:signMessage", "solana:signTransaction"] as const;
const chainFor = (c: Cluster) => `solana:${c === "mainnet-beta" ? "mainnet" : c}`;

let cachedAccount: Account | null = null;
function accountsFor(chains: readonly string[]): Account[] {
  const s = readSession();
  if (!s) { cachedAccount = null; return []; }
  // The adapter compares accounts by identity, so the same session must yield the same object.
  if (cachedAccount?.address !== s.publicKey) {
    cachedAccount = { address: s.publicKey, publicKey: bs58.decode(s.publicKey), chains, features: ACCOUNT_FEATURES, label: PHANTOM_WALLET_NAME, icon: ICON };
  }
  return [cachedAccount];
}

type ChangeListener = (properties: { accounts?: Account[] }) => void;

function makeWallet(cluster: Cluster) {
  const chains = [chainFor(cluster)] as const;
  const listeners = new Set<ChangeListener>();
  const emit = () => { const accounts = accountsFor(chains); listeners.forEach((f) => f({ accounts })); };
  window.addEventListener("storage", (e) => { if (e.key === null || e.key === SESSION_KEY) emit(); });

  return {
    version: "1.0.0" as const,
    name: PHANTOM_WALLET_NAME,
    icon: ICON,
    chains,
    get accounts() { return accountsFor(chains); },
    features: {
      "standard:connect": {
        version: "1.0.0" as const,
        connect: async (input?: { silent?: boolean }) => {
          if (readSession()) return { accounts: accountsFor(chains) };
          // Auto-connect on page load must never bounce someone to the Phantom app unasked.
          if (input?.silent) throw new Error("Not connected to Phantom in this browser yet.");
          const keys = newEncryptionKeys();
          await perform("connect", (id) => ({
            url: connectUrl({ appUrl: window.location.origin, dappPublicKey: keys.publicKey, redirect: returnUrl(id), cluster }),
            dappPublicKey: keys.publicKey,
            dappSecretKey: keys.secretKey,
          }));
          emit();
          return { accounts: accountsFor(chains) };
        },
      },
      "standard:disconnect": {
        version: "1.0.0" as const,
        // Local only: Phantom's own disconnect link would bounce out to the app for nothing.
        disconnect: async () => {
          clearSession();
          emit();
          // Browsers that fire `beforeunload` for the hop (Chromium does, even when the
          // navigation is then handed to the app) leave the wallet adapter believing the
          // page is closing, and it drops every disconnect event after that. A reload is
          // the one reset it cannot ignore, and a disconnect is a natural moment for it.
          if (hopped) setTimeout(() => window.location.reload(), 0);
        },
      },
      "standard:events": {
        version: "1.0.0" as const,
        on: (event: string, fn: ChangeListener) => {
          if (event !== "change") return () => {};
          listeners.add(fn);
          return () => { listeners.delete(fn); };
        },
      },
      "solana:signMessage": {
        version: "1.0.0" as const,
        signMessage: async (...inputs: { message: Uint8Array }[]) => {
          const out: { signedMessage: Uint8Array; signature: Uint8Array }[] = [];
          for (const input of inputs) {
            const { signature } = await signed<{ signature: string }>("signMessage", { message: bs58.encode(input.message), display: "utf8" });
            out.push({ signedMessage: input.message, signature: bs58.decode(signature) });
          }
          return out;
        },
      },
      "solana:signTransaction": {
        version: "1.0.0" as const,
        supportedTransactionVersions: ["legacy", 0] as const,
        signTransaction: async (...inputs: { transaction: Uint8Array }[]) => {
          if (inputs.length === 1) {
            const { transaction } = await signed<{ transaction: string }>("signTransaction", { transaction: bs58.encode(inputs[0].transaction) });
            return [{ signedTransaction: bs58.decode(transaction) }];
          }
          const { transactions } = await signed<{ transactions: string[] }>("signAllTransactions", { transactions: inputs.map((i) => bs58.encode(i.transaction)) });
          return transactions.map((t) => ({ signedTransaction: bs58.decode(t) }));
        },
      },
    },
  };
}

let registered = false;

/**
 * Offers the wallet where it can work: a phone browser that is neither Phantom's own nor
 * an installed home-screen app. Wallet Standard discovery is two events — one we fire in
 * case the app is already listening, one we answer if it starts listening later.
 */
export function registerPhantomDeeplinkWallet(cluster: Cluster) {
  if (registered || typeof window === "undefined" || !deeplinkAvailable()) return;
  registered = true;
  sweepRecords();
  const wallet = makeWallet(cluster);
  const callback = (api: { register: (...wallets: unknown[]) => void }) => api.register(wallet);
  window.addEventListener("wallet-standard:app-ready", (e) => callback((e as CustomEvent<{ register: (...wallets: unknown[]) => void }>).detail));
  window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: callback }));
}
