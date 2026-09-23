import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hasNoViewMetricHost, NO_VIEW_METRIC_HOSTS } from "../lib/platform-kind.ts";

test("확정 무지표 매체만 정상 제외하고 모르는 주소는 숨기지 않는다", () => {
  for (const url of [
    "https://www.threads.net/@a/post/x",
    "https://www.facebook.com/a/videos/1",
    "https://m.blog.naver.com/a/1",
    "https://shortform.kakao.com/contents/x/",
  ]) assert.equal(hasNoViewMetricHost(url), true, url);

  for (const url of [
    "https://www.instagram.com/p/x/",
    "https://www.youtube.com/watch?v=x",
    "https://www.tiktok.com/@a/video/1/",
    "https://example.com/x",
    "",
  ]) assert.equal(hasNoViewMetricHost(url), false, url);
});

test("TS와 Python의 무지표 호스트 목록은 같은 계약이다", () => {
  const py = readFileSync(new URL("../../scripts/platform_kind.py", import.meta.url), "utf8");
  const match = py.match(/NO_VIEW_METRIC_HOSTS\s*=\s*\(([^)]*)\)/);
  assert.ok(match, "Python NO_VIEW_METRIC_HOSTS 상수를 찾지 못함");
  const pythonHosts = [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);
  assert.deepEqual([...NO_VIEW_METRIC_HOSTS], pythonHosts);
});

test("수식감사 라우트가 공용 배너·무지표 정책으로 제외 사유를 만든다", () => {
  const route = readFileSync(new URL("../app/api/sponsored-posts/formula-audit/route.ts", import.meta.url), "utf8");
  assert.match(route, /hasNoViewMetricHost\(url\)/);
  assert.match(route, /isBannerChannel\(channelType, posted\)/);
  assert.match(route, /staleExclusionReason/);
  assert.match(route, /stale_excluded_uncollectable:\s*result\.staleExcludedUncollectable/);
});
