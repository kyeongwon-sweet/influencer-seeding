import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../app/monitoring/components/PostsTable.tsx", import.meta.url),
  "utf8",
);

test("게시물 합계 행은 데이터 행 사이가 아니라 헤더 바로 아래에 고정된다", () => {
  const totalRow = source.indexOf("tableTotals.selectionMode || hasFilter");
  const theadEnd = source.indexOf("</thead>", totalRow);
  const tbodyStart = source.indexOf("<tbody>", theadEnd);
  const dataRows = source.indexOf("visiblePosts.map", tbodyStart);

  assert.ok(totalRow >= 0, "합계 행을 찾을 수 없음");
  assert.ok(theadEnd > totalRow, "합계 행은 thead 안에 있어야 함");
  assert.ok(tbodyStart > theadEnd, "tbody는 합계 헤더 뒤에 시작해야 함");
  assert.ok(dataRows > tbodyStart, "데이터 행은 tbody 안에 있어야 함");
});
