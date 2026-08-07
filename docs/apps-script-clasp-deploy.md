# Apps Script clasp deploy policy

This repo manages the production Apps Script through a staged clasp deploy path.
Do not paste the full script manually in the browser except for emergency rollback.

## Production Target

- Script ID: `1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn`
- `.clasp.json` rootDir: `dist/apps-script`
- Live Apps Script currently has more files than the repo-owned source set.
  The deploy script pulls live first, preserves those live-only files, and overlays only these repo-owned files:
  - `Combined_Sheet_AppsScript.gs` -> `AI 트래킹 대시보드 연동.js`
  - `_WriteGuard.gs` -> `_WriteGuard.js`
  - `apps-script/인사이트_문의_메시지_자동생성.gs` -> `인사이트_문의_메시지_자동생성.js`
  - `apps-script/appsscript.json` -> `appsscript.json`

## Normal Flow

From `web/`:

```powershell
npm.cmd run apps-script:prepare
```

This creates `dist/apps-script` and verifies key safety markers without writing live Apps Script.

Then run the tests:

```powershell
npm.cmd test
npx.cmd tsc --noEmit
```

To push to live Apps Script:

```powershell
$env:APPS_SCRIPT_ALLOW_PUSH="1"
$env:APPS_SCRIPT_EXPECTED_SCRIPT_ID="1XogwTHJb-oanoOw3suAt9rgh8H6vOqkIZwAWTZdgS_mhc1yaFjU6JrCn"
npm.cmd run apps-script:deploy
```

The deploy command:

1. Rebuilds `dist/apps-script` from repo source.
2. Pulls live Apps Script to preserve live-only files.
3. Overlays the repo-owned files listed above.
4. Runs `clasp status`.
5. Runs `clasp push`.
6. Runs `clasp pull`.
7. Verifies the pulled live files still match the staged repo source.

If the post-push live pull does not match, treat it as a failed deploy and stop.

## Rules

- Never run raw `clasp push` from the repo root for production.
- Never push from a stale browser editor tab.
- Never edit `dist/apps-script` by hand; it is generated and ignored by git.
- If another session has uncommitted Apps Script changes, either merge them into the repo source first or stop.
- Record meaningful live pushes in `AI_SHARED_STATUS.md`.
