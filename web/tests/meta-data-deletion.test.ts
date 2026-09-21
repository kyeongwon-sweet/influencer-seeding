import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildMetaDataDeletionStatusUrl,
  createMetaDataDeletionReceipt,
  parseMetaDataDeletionSignedRequest,
  verifyMetaDataDeletionReceipt,
} from "../lib/meta-data-deletion.ts";

function base64Url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function signedRequest(payload: object, secret: string): string {
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(encodedPayload).digest();
  return `${base64Url(signature)}.${encodedPayload}`;
}

test("Meta data deletion signed_request accepts only a valid HMAC", () => {
  const request = signedRequest({ algorithm: "HMAC-SHA256", user_id: "asid-123" }, "secret");
  assert.deepEqual(parseMetaDataDeletionSignedRequest(request, "secret"), { userId: "asid-123" });
  assert.equal(parseMetaDataDeletionSignedRequest(request, "wrong"), null);
  assert.equal(parseMetaDataDeletionSignedRequest(`${request}x`, "secret"), null);
});

test("Meta data deletion signed_request rejects unsupported or incomplete payloads", () => {
  assert.equal(
    parseMetaDataDeletionSignedRequest(signedRequest({ algorithm: "none", user_id: "u" }, "s"), "s"),
    null,
  );
  assert.equal(
    parseMetaDataDeletionSignedRequest(signedRequest({ algorithm: "HMAC-SHA256" }, "s"), "s"),
    null,
  );
});

test("data deletion receipt is stateless, verifiable, and contains no user identifier", () => {
  const receipt = createMetaDataDeletionReceipt("secret", () => Buffer.alloc(16, 0xab));
  assert.equal(receipt.confirmationCode, "ab".repeat(16));
  assert.equal(verifyMetaDataDeletionReceipt(receipt.confirmationCode, receipt.proof, "secret"), true);
  assert.equal(verifyMetaDataDeletionReceipt(receipt.confirmationCode, receipt.proof, "wrong"), false);
  assert.equal(verifyMetaDataDeletionReceipt(receipt.confirmationCode, `0${receipt.proof.slice(1)}`, "secret"), false);

  const url = buildMetaDataDeletionStatusUrl(
    "https://example.com/ignored/path",
    receipt.confirmationCode,
    receipt.proof,
  );
  assert.match(url, /^https:\/\/example\.com\/api\/meta\/data-deletion\/status\?/);
  assert.equal(url.includes("asid"), false);
});

test("Meta data deletion callback is public only with its signed-request verification", () => {
  const middleware = fs.readFileSync(path.resolve(process.cwd(), "middleware.ts"), "utf8");
  const callback = fs.readFileSync(
    path.resolve(process.cwd(), "app/api/meta/data-deletion/route.ts"),
    "utf8",
  );
  assert.match(middleware, /\/api\/meta\/data-deletion/);
  assert.match(callback, /parseMetaDataDeletionSignedRequest/);
  assert.doesNotMatch(callback, /console\.(?:log|info|error)\([^\n]*userId/);
});
