/**
 * Phantom's half of the deep-link exchange, played here against ours.
 *
 * The wire format is a URL with an encrypted blob in it, so the only way to know the site
 * builds what Phantom expects is to open it the way Phantom does: derive the shared key
 * from the dapp's public half, and decrypt. If these agree, a real Phantom will too.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  connectUrl, decryptPayload, describePhantomError, methodUrl, newEncryptionKeys, sessionLost, sharedSecret,
} from "../src/lib/client/phantom-deeplink-core";

const SITE = "https://project-takeover.com";

/** What the Phantom app does with our public key: the other side of Diffie–Hellman. */
function phantomSide(dappPublicKey: string) {
  const kp = nacl.box.keyPair();
  const shared = nacl.box.before(bs58.decode(dappPublicKey), kp.secretKey);
  const encrypt = (obj: unknown) => {
    const nonce = nacl.randomBytes(24);
    const data = nacl.box.after(Buffer.from(JSON.stringify(obj)), nonce, shared);
    return { nonce: bs58.encode(nonce), data: bs58.encode(data) };
  };
  const decrypt = (payload: string, nonce: string) => {
    const opened = nacl.box.open.after(bs58.decode(payload), bs58.decode(nonce), shared);
    assert.ok(opened, "Phantom could not open the payload");
    return JSON.parse(Buffer.from(opened).toString());
  };
  return { publicKey: bs58.encode(kp.publicKey), shared, encrypt, decrypt };
}

test("the connect link carries what Phantom needs, and both sides derive the same key", () => {
  const keys = newEncryptionKeys();
  const url = new URL(connectUrl({ appUrl: SITE, dappPublicKey: keys.publicKey, redirect: `${SITE}/wallet/return/abc`, cluster: "mainnet-beta" }));
  assert.equal(url.origin + url.pathname, "https://phantom.app/ul/v1/connect");
  assert.equal(url.searchParams.get("app_url"), SITE);
  assert.equal(url.searchParams.get("dapp_encryption_public_key"), keys.publicKey);
  assert.equal(url.searchParams.get("redirect_link"), `${SITE}/wallet/return/abc`);
  assert.equal(url.searchParams.get("cluster"), "mainnet-beta");

  const phantom = phantomSide(keys.publicKey);
  const ours = sharedSecret(phantom.publicKey, keys.secretKey);
  assert.deepEqual(Buffer.from(ours), Buffer.from(phantom.shared));

  const { nonce, data } = phantom.encrypt({ public_key: "8kK…", session: "tok" });
  assert.deepEqual(decryptPayload(data, nonce, ours), { public_key: "8kK…", session: "tok" });
});

test("a signing link is opaque on the wire and exact once Phantom opens it", () => {
  const keys = newEncryptionKeys();
  const phantom = phantomSide(keys.publicKey);
  const shared = sharedSecret(phantom.publicKey, keys.secretKey);
  const message = bs58.encode(Buffer.from("Project: Takeover · sign in"));
  const href = methodUrl("signMessage", {
    dappPublicKey: keys.publicKey, redirect: `${SITE}/wallet/return/xyz`, shared,
    payload: { message, session: "tok", display: "utf8" },
  });
  const url = new URL(href);
  assert.equal(url.pathname, "/ul/v1/signMessage");
  assert.ok(!href.includes(message), "the message must not appear in the clear");
  assert.ok(!href.includes("tok"), "the session token must not appear in the clear");
  const opened = phantom.decrypt(url.searchParams.get("payload")!, url.searchParams.get("nonce")!);
  assert.deepEqual(opened, { message, session: "tok", display: "utf8" });
});

test("a reply that was tampered with is refused rather than misread", () => {
  const keys = newEncryptionKeys();
  const phantom = phantomSide(keys.publicKey);
  const shared = sharedSecret(phantom.publicKey, keys.secretKey);
  const { nonce, data } = phantom.encrypt({ signature: "sig" });
  const bytes = bs58.decode(data);
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decryptPayload(bs58.encode(bytes), nonce, shared), /could not be decrypted/);
  // And a reply for a different key pair is just as unreadable.
  const other = sharedSecret(phantom.publicKey, newEncryptionKeys().secretKey);
  assert.throws(() => decryptPayload(data, nonce, other), /could not be decrypted/);
});

test("Phantom's error codes become sentences, and a dead session is recognised", () => {
  assert.equal(describePhantomError("4001", "User rejected the request."), "You cancelled it in Phantom. Nothing was sent.");
  assert.equal(describePhantomError("-32603", "Something broke"), "Phantom said: Something broke");
  assert.equal(describePhantomError("-32000", null), "Phantom returned an error (-32000).");
  assert.equal(sessionLost("4900", null), true);
  assert.equal(sessionLost("-32000", "Invalid session"), true);
  assert.equal(sessionLost("4001", "User rejected the request."), false);
});
