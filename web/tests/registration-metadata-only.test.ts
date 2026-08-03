import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";


const sponsoredWrite = readFileSync(
  new URL("../lib/sponsored-write.ts", import.meta.url),
  "utf8",
);
const webhook = readFileSync(
  new URL("../app/api/apify-webhook/route.ts", import.meta.url),
  "utf8",
);


test("new-post metadata scrape marks the webhook as metadata-only", () => {
  assert.match(sponsoredWrite, /jobType=monitoring&metadataOnly=1/);
});


test("metadata-only webhook updates metadata but skips daily stats", () => {
  assert.match(webhook, /searchParams\.get\('metadataOnly'\) === '1'/);
  assert.match(webhook, /if \(metadataOnly\) continue;/);
  assert.match(webhook, /if \(!metadataOnly\) \{/);
  assert.match(webhook, /metadata_only: metadataOnly/);
});
