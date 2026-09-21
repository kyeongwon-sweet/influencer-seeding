import { NextRequest, NextResponse } from "next/server";
import {
  buildMetaDataDeletionStatusUrl,
  createMetaDataDeletionReceipt,
  parseMetaDataDeletionSignedRequest,
} from "@/lib/meta-data-deletion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function appBaseUrl(req: NextRequest): string {
  const configured = (process.env.APP_URL || "").trim();
  return configured || req.nextUrl.origin;
}

export async function POST(req: NextRequest) {
  const appSecret = (process.env.META_APP_SECRET || "").trim();
  if (!appSecret) {
    console.error("[meta-data-deletion] META_APP_SECRET is not configured");
    return NextResponse.json({ error: "service unavailable" }, { status: 503 });
  }

  let signedRequest = "";
  try {
    const form = await req.formData();
    signedRequest = String(form.get("signed_request") || "");
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  const verified = parseMetaDataDeletionSignedRequest(signedRequest, appSecret);
  if (!verified) {
    return NextResponse.json({ error: "invalid signed_request" }, { status: 401 });
  }

  // This app does not persist Facebook app-scoped user profiles or an ASID-linked
  // user table. The verified request therefore has no matching stored profile data
  // to delete and can be completed immediately. Never log the user ID or request.
  const receipt = createMetaDataDeletionReceipt(appSecret);
  const url = buildMetaDataDeletionStatusUrl(
    appBaseUrl(req),
    receipt.confirmationCode,
    receipt.proof,
  );
  console.info("[meta-data-deletion] verified request completed", {
    storesAppScopedUserProfiles: false,
  });

  return NextResponse.json(
    { url, confirmation_code: receipt.confirmationCode },
    { headers: { "Cache-Control": "no-store" } },
  );
}
