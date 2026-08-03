# Live ↔ repository Apps Script drift

## File inventory

The live project contains eight source files that have no same-file counterpart in the active repository mirror:

- `cleanup_url_params_20260730.js`
- `repair_rd_main_import_20260728.js`
- `repair_tiktok_20260729.js`
- `repair_zero_metrics_20260728.js`
- `schedule_heartbeat.js`
- `바이럴 업체명 채우기.js`
- `바이럴 최신효율 업데이트.js`
- `업로드 일보다 이전 데이터 삭제.js`

The live `인사이트_문의_메시지_자동생성.js` and repository `apps-script/인사이트_문의_메시지_자동생성.gs` are the same implementation after line-ending normalization at the time of the pull.

## Main-file structure

Comparison target:

- live: `AI 트래킹 대시보드 연동.js`
- repository: `Combined_Sheet_AppsScript.gs` + `_WriteGuard.gs`

The live main has 130 named functions; the repository pair has 115. Function-name comparison found 28 names only in live and 12 names only in the repository pair. The textual diff is large (1,258 insertions / 1,088 deletions) because the live file contains applied `__wgimpl` wrappers and historical inline edits, while the repository keeps reusable guard helpers and newer unapplied code separately.

### Only in live main

`addPricingCandidate_`, `applyPricingRow_`, `buildPricingMaps_`, `buildUrlKeyList_`, `checkSheetIssues`, `checkSheetIssues__wgimpl`, `diagnoseJcolumnTemp`, `exportStats__wgimpl`, `findStatusCol_`, `getPricingCols_`, `importStats__wgimpl`, `installCreatorEditTrigger`, `normalizeCaption_`, `onEdit`, `postTrackingStatus_`, `pricingFormat_`, `pricingKey_`, `pullFromDB__wgimpl`, `refreshCumulativeViews__wgimpl`, `removeDuplicateLinks__wgimpl`, `runSync___wgimpl`, `syncCreators__wgimpl`, `syncManualCreatorsOnEdit`, `syncPricing__wgimpl`, `syncStatus__wgimpl`, `uniquePricingMap_`, `withDocLockBroken_`.

### Only in repository main + guard

`addUniqueMapValue_`, `auditLinkedSheetFormulas`, `auditLinkedSheetFormulas_`, `buildUrlKeyIndex_`, `headerDate_`, `installScheduleHeartbeatTrigger`, `onlyUniqueMapValue_`, `priceChannelKey_`, `pricingFormatFromType_`, `removeScheduleHeartbeatTrigger`, `scheduleHeartbeat`, `warnDateColumnEdit_`.

## Reconciliation decision

Do **not** replace either side wholesale:

- The live-only `__wgimpl` names are runtime-applied write-guard wrappers, not independent features to paste back into the clean mirror.
- Several live-only names are one-off repair/diagnostic or legacy compatibility code.
- Several repository-only names are newer validation/audit helpers; overwriting the mirror with live would lose them.
- The six operational live-only entry points `onEdit`, `syncManualCreatorsOnEdit`, `installCreatorEditTrigger`, `postTrackingStatus_`, `normalizeCaption_`, and `findStatusCol_`, plus the pricing implementation, require behavior-level reconciliation before changing the deploy mirror.

Therefore this snapshot is the recovery source of truth for the live state, while `Combined_Sheet_AppsScript.gs` remains the reviewed deployment mirror. Future reconciliation must be function-scoped with contract tests; this pull intentionally made no live write and no wholesale mirror replacement.
