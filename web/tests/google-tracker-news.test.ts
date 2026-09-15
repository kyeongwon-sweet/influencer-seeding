import { test } from "node:test";
import assert from "node:assert/strict";
import { googleNewsUrl, parseGoogleNews } from "../lib/google-tracker-news.ts";
test("RSS evidence uses publication dates, no fabricated views, and rejects entity declarations", () => {
  const item = (title: string, date: string, link = "https://news.google.com/rss/articles/abc") => `<item><title>${title}</title><link>${link}</link><pubDate>${date}</pubDate><source url="https://example.com">Publisher</source><description>&lt;b&gt;News&lt;/b&gt;</description></item>`;
  const xml = `<rss><channel>${item("Brand &amp; News", "Fri, 04 Sep 2026 04:58:00 GMT")}${item("Old", "Tue, 01 Sep 2026 04:58:00 GMT", "https://news.google.com/old")}${item("Bad", "Fri, 04 Sep 2026 04:58:00 GMT", "javascript:alert(1)")}</channel></rss>`;
  const rows = parseGoogleNews(xml, "2026-09-02", "2026-09-16");
  assert.equal(rows.length, 1); assert.equal(rows[0].title, "Brand & News"); assert.equal(rows[0].date, "2026-09-04"); assert.equal(rows[0].description, "News"); assert.equal(rows[0].author, "Publisher"); assert.equal(rows[0].views, null);
  assert.throws(() => parseGoogleNews('<!DOCTYPE rss><rss/>', "2026-09-02", "2026-09-16"));
  assert.deepEqual(parseGoogleNews('<rss><channel><title>Empty</title></channel></rss>', "2026-09-02", "2026-09-16"), []);
  const url = new URL(googleNewsUrl({ groups: [{ id:"g0", label:"Brand", terms:["brand", "variant"], tags:[] }], start:"2026-01-01",end:"2026-09-14",geo:"KR",multiplier:2.5,minIndex:5,gapDays:7,windowDays:7 }, 0, "2026-09-02", "2026-09-16"));
  assert.equal(url.hostname, "news.google.com"); assert.match(url.searchParams.get("q")!, /OR.*before:2026-09-17/);
});
