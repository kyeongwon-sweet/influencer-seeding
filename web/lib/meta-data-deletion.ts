import crypto from "node:crypto";

const SIGNED_REQUEST_ALGORITHM = "HMAC-SHA256";
const STATUS_CONTEXT = "meta-data-deletion-status:v1";

type MetaSignedRequestPayload = {
  algorithm?: unknown;
  user_id?: unknown;
};

function decodeBase64Url(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, "base64");
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function parseMetaDataDeletionSignedRequest(
  signedRequest: string,
  appSecret: string,
): { userId: string } | null {
  if (!signedRequest || !appSecret) return null;

  const separator = signedRequest.indexOf(".");
  if (separator <= 0 || separator === signedRequest.length - 1) return null;

  const encodedSignature = signedRequest.slice(0, separator);
  const encodedPayload = signedRequest.slice(separator + 1);

  let suppliedSignature: Buffer;
  let payload: MetaSignedRequestPayload;
  try {
    suppliedSignature = decodeBase64Url(encodedSignature);
    payload = JSON.parse(decodeBase64Url(encodedPayload).toString("utf8")) as MetaSignedRequestPayload;
  } catch {
    return null;
  }

  const expectedSignature = crypto
    .createHmac("sha256", appSecret)
    .update(encodedPayload)
    .digest();
  if (!safeEqual(suppliedSignature, expectedSignature)) return null;
  if (String(payload.algorithm || "").toUpperCase() !== SIGNED_REQUEST_ALGORITHM) return null;

  const userId = typeof payload.user_id === "string" ? payload.user_id.trim() : "";
  return userId ? { userId } : null;
}

export function createMetaDataDeletionReceipt(
  appSecret: string,
  randomBytes: (size: number) => Buffer = crypto.randomBytes,
): { confirmationCode: string; proof: string } {
  const confirmationCode = randomBytes(16).toString("hex");
  const proof = crypto
    .createHmac("sha256", appSecret)
    .update(`${STATUS_CONTEXT}:${confirmationCode}`)
    .digest("hex");
  return { confirmationCode, proof };
}

export function verifyMetaDataDeletionReceipt(
  confirmationCode: string,
  proof: string,
  appSecret: string,
): boolean {
  if (!/^[a-f0-9]{32}$/i.test(confirmationCode) || !/^[a-f0-9]{64}$/i.test(proof) || !appSecret) {
    return false;
  }
  const expected = crypto
    .createHmac("sha256", appSecret)
    .update(`${STATUS_CONTEXT}:${confirmationCode.toLowerCase()}`)
    .digest();
  return safeEqual(Buffer.from(proof, "hex"), expected);
}

export function buildMetaDataDeletionStatusUrl(
  baseUrl: string,
  confirmationCode: string,
  proof: string,
): string {
  const url = new URL("/api/meta/data-deletion/status", baseUrl);
  url.searchParams.set("code", confirmationCode);
  url.searchParams.set("proof", proof);
  return url.toString();
}
