/**
 * A cover image for scripts that create listings.
 *
 * Every listing must arrive with one, which is a rule about sellers rather than about
 * tests — so the scripts that drive the API stage a small generated PNG and pass the name
 * back like a browser would. The picture is a flat colour keyed to the caller's label, so
 * a seeded market does not come out as a wall of identical squares.
 */
import crypto from "node:crypto";
import zlib from "node:zlib";
import nacl from "tweetnacl";
import bs58 from "bs58";

/** CRC-32, which is the only fiddly part of writing a PNG by hand. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A 2x1 PNG in one flat colour — the smallest thing that is honestly a picture. */
export function flatPng(seed = "") {
  const h = crypto.createHash("sha256").update(seed).digest();
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(2, 0); // width
  ihdr.writeUInt32BE(1, 4); // height
  ihdr[8] = 8;              // bit depth
  ihdr[9] = 2;              // truecolour
  // One scanline: filter byte, then two identical RGB pixels.
  const raw = Buffer.from([0, h[0], h[1], h[2], h[0], h[1], h[2]]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Upload a cover as `kp` and return the stored name to pass to POST /api/listings. */
export async function stageCover(base, kp, seed = "") {
  const timestamp = Date.now();
  const msg = `Takeover\naction: upload\nlisting: -\nts: ${timestamp}`;
  const auth = {
    pubkey: kp.publicKey.toBase58(),
    timestamp,
    signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(msg), kp.secretKey)),
  };
  const form = new FormData();
  form.append("auth", JSON.stringify(auth));
  form.append("file", new Blob([flatPng(seed)], { type: "image/png" }), "cover.png");
  const r = await fetch(`${base}/api/uploads`, { method: "POST", body: form });
  const j = await r.json();
  if (!r.ok) throw new Error(`/api/uploads: ${j.error}`);
  return j.image;
}
