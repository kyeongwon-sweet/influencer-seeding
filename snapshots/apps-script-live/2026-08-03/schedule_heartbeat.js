// GitHub schedule heartbeat from Google Apps Script time trigger.
// Added live on 2026-07-30 to detect GitHub schedule-wide stalls from a different scheduler.
function scheduleHeartbeatUrl_() {
  if (typeof CONFIG === "undefined") {
    throw new Error("CONFIG is not defined");
  }
  CONFIG.SCHEDULE_HEARTBEAT_URL = CONFIG.SCHEDULE_HEARTBEAT_URL || "https://influencer-seeding-mu.vercel.app/api/ops/schedule-heartbeat";
  return CONFIG.SCHEDULE_HEARTBEAT_URL;
}

function scheduleHeartbeat() {
  const res = UrlFetchApp.fetch(scheduleHeartbeatUrl_(), {
    method: "post",
    headers: authHeaders_(),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  const body = res.getContentText();
  Logger.log("[scheduleHeartbeat] HTTP " + code + " " + body.slice(0, 500));
  if (code !== 200) {
    throw new Error("scheduleHeartbeat HTTP " + code + ": " + body.slice(0, 200));
  }
  return true;
}

function installScheduleHeartbeatTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === "scheduleHeartbeat")
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("scheduleHeartbeat").timeBased().everyHours(2).create();
  Logger.log("GitHub schedule heartbeat trigger installed: every 2 hours.");
  scheduleHeartbeat();
  return true;
}

function removeScheduleHeartbeatTrigger() {
  const triggers = ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === "scheduleHeartbeat");
  triggers.forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log("GitHub schedule heartbeat trigger removed: " + triggers.length);
  return triggers.length;
}
