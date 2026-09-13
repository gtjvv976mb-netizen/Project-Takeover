/**
 * The DNS proof is the only thing standing between "I own this website" and a stranger
 * typing that sentence about somebody else's website, so its edge cases are worth pinning:
 * what counts as a host, what counts as a match, and what must never count as proven.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expectedTxt, hostOf } from "../src/lib/domain";

describe("expected TXT record", () => {
  it("names the wallet, so one domain's proof cannot be reused by another seller", () => {
    assert.equal(expectedTxt("ABC123"), "takeover-verify=ABC123");
    assert.notEqual(expectedTxt("ABC123"), expectedTxt("XYZ789"));
  });
});

describe("host extraction", () => {
  it("reduces a URL to its registrable host", () => {
    assert.equal(hostOf("https://example.com/path?a=1"), "example.com");
    assert.equal(hostOf("http://EXAMPLE.com"), "example.com");
    assert.equal(hostOf("https://www.example.com"), "example.com");
    assert.equal(hostOf("https://sub.example.com"), "sub.example.com");
    assert.equal(hostOf("https://example.com:8443/x"), "example.com");
  });
  it("refuses anything with no TXT record a seller could own", () => {
    // An IP address has no owner-controlled TXT record.
    assert.equal(hostOf("http://127.0.0.1:3000"), null);
    assert.equal(hostOf("https://192.168.1.1"), null);
    // A single label is not a registrable domain.
    assert.equal(hostOf("http://localhost"), null);
    // Schemes we cannot reason about must not silently pass.
    assert.equal(hostOf("ftp://example.com"), null);
    assert.equal(hostOf("javascript:alert(1)"), null);
    assert.equal(hostOf("data:text/html,hi"), null);
    assert.equal(hostOf("not a url"), null);
    assert.equal(hostOf(""), null);
  });
  it("does not let a lookalike host pass as the real one", () => {
    assert.notEqual(hostOf("https://example.com.evil.tld"), "example.com");
    assert.equal(hostOf("https://example.com.evil.tld"), "example.com.evil.tld");
  });
});
