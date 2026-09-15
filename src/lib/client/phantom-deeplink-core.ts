/**
 * The Phantom deep-link protocol, minus the browser.
 *
 * On a phone there is no wallet extension. Phantom instead publishes a set of universal
 * links: the site opens one, the Phantom app shows the request, and Phantom opens the
 * site's `redirect_link` with the answer in its query string. Both directions are
 * encrypted with a key agreed between the two sides — x25519 Diffie–Hellman, then NaCl's
 * secretbox — so nothing in either URL is readable by whatever sits between the apps.
 *
 * Everything here is a pure function of its arguments, which is what lets the unit test
 * play Phantom's half of the exchange and prove the two halves agree.
 *
 * Reference: https://docs.phantom.com/phantom-deeplinks/deeplinks-ios-and-android
 */
import nacl from "tweetnacl";
import bs58 from "bs58";

export const PHANTOM_UL = "https://phantom.app/ul/v1";

export type Cluster = "mainnet-beta" | "devnet" | "testnet";
export type DeeplinkMethod = "connect" | "signMessage" | "signTransaction" | "signAllTransactions";

/** One x25519 keypair per connection; the public half rides in the connect link. */
export function newEncryptionKeys(): { publicKey: string; secretKey: string } {
  const kp = nacl.box.keyPair();
  return { publicKey: bs58.encode(kp.publicKey), secretKey: bs58.encode(kp.secretKey) };
}

/** The symmetric key both sides derive: Phantom's public half against ours in secret. */
export function sharedSecret(phantomPublicKey: string, dappSecretKey: string): Uint8Array {
  return nacl.box.before(bs58.decode(phantomPublicKey), bs58.decode(dappSecretKey));
}

export function encryptPayload(payload: unknown, shared: Uint8Array): { nonce: string; payload: string } {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)), nonce, shared);
  return { nonce: bs58.encode(nonce), payload: bs58.encode(box) };
}

export function decryptPayload<T>(data: string, nonce: string, shared: Uint8Array): T {
  const opened = nacl.box.open.after(bs58.decode(data), bs58.decode(nonce), shared);
  if (!opened) throw new Error("Phantom's reply could not be decrypted — connect again");
  return JSON.parse(new TextDecoder().decode(opened)) as T;
}

/** `connect` is the one link sent in the clear: there is no shared key yet. */
export function connectUrl(o: { appUrl: string; dappPublicKey: string; redirect: string; cluster: Cluster }): string {
  const q = new URLSearchParams({
    app_url: o.appUrl,
    dapp_encryption_public_key: o.dappPublicKey,
    redirect_link: o.redirect,
    cluster: o.cluster,
  });
  return `${PHANTOM_UL}/connect?${q}`;
}

/** Every later link carries an encrypted payload that includes the session token. */
export function methodUrl(
  method: Exclude<DeeplinkMethod, "connect">,
  o: { dappPublicKey: string; redirect: string; shared: Uint8Array; payload: Record<string, unknown> },
): string {
  const { nonce, payload } = encryptPayload(o.payload, o.shared);
  const q = new URLSearchParams({ dapp_encryption_public_key: o.dappPublicKey, nonce, redirect_link: o.redirect, payload });
  return `${PHANTOM_UL}/${method}?${q}`;
}

/** Phantom's error codes follow EIP-1193: 4001 is the person tapping "reject". */
export function describePhantomError(code: string | null, message: string | null): string {
  if (code === "4001" || /rejected/i.test(message ?? "")) return "You cancelled it in Phantom. Nothing was sent.";
  if (message) return `Phantom said: ${message}`;
  return `Phantom returned an error${code ? ` (${code})` : ""}.`;
}

/** 4900 is "disconnected"; either way the session token is no longer good. */
export function sessionLost(code: string | null, message: string | null): boolean {
  return code === "4900" || /session|disconnected|unauthori[sz]ed/i.test(message ?? "");
}
