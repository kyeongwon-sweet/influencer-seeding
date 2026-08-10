param(
  [ValidateSet("dispatch", "local", "check")]
  [string] $Mode = "dispatch",
  [string] $Date = "",
  [string] $Repo = "kyeongwon-sweet/influencer-seeding",
  [string] $Ref = "main",
  [switch] $RecollectAll,
  [switch] $ApiOnly,
  [switch] $MetadataOnly,
  [switch] $NoWatch
)

$ErrorActionPreference = "Stop"

function Get-RepoRoot {
  $root = git rev-parse --show-toplevel 2>$null
  if (-not $root) {
    throw "This script must be run inside the influencer-seeding git repository."
  }
  return $root.Trim()
}

function Get-KstYesterday {
  return (Get-Date).AddDays(-1).ToString("yyyy-MM-dd")
}

function Import-RecoveryEnv {
  param([string] $RepoRoot)

  $candidates = @(
    (Join-Path $RepoRoot ".env.recovery.local"),
    (Join-Path $RepoRoot ".env")
  )

  $loaded = @()
  foreach ($path in $candidates) {
    if (-not (Test-Path -LiteralPath $path)) {
      continue
    }
    foreach ($line in Get-Content -LiteralPath $path -Encoding UTF8) {
      $trimmed = $line.Trim()
      if (-not $trimmed -or $trimmed.StartsWith("#") -or -not $trimmed.Contains("=")) {
        continue
      }
      $parts = $trimmed.Split("=", 2)
      $key = $parts[0].Trim()
      $value = $parts[1].Trim()
      if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
        $value = $value.Substring(1, $value.Length - 2)
      }
      [Environment]::SetEnvironmentVariable($key, $value, "Process")
    }
    $loaded += $path
  }

  return $loaded
}

function Require-Env {
  param([string[]] $Names)

  $missing = @()
  foreach ($name in $Names) {
    $value = [Environment]::GetEnvironmentVariable($name, "Process")
    if (-not $value) {
      $missing += $name
    }
  }
  if ($missing.Count -gt 0) {
    throw ("Missing required local recovery env: " + ($missing -join ", ") + "`n" +
      "Create .env.recovery.local or .env with those values, or run -Mode dispatch to use GitHub Actions secrets.")
  }
}

function Invoke-Checked {
  param([string] $FilePath, [string[]] $Arguments)
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

$repoRoot = Get-RepoRoot
Set-Location -LiteralPath $repoRoot

if (-not $Date) {
  $Date = Get-KstYesterday
}

Write-Host "[recovery] mode=$Mode date=$Date repo=$Repo ref=$Ref"

if ($Mode -eq "dispatch") {
  $expected = Get-KstYesterday
  if ($Date -ne $expected) {
    throw "GitHub workflow recovery always uses KST yesterday ($expected). For an explicit date ($Date), use -Mode local with recovery env."
  }

  $args = @(
    "workflow", "run", "cron-daily-collect.yml",
    "--repo", $Repo,
    "--ref", $Ref,
    "-f", ("api_only=" + $ApiOnly.IsPresent.ToString().ToLowerInvariant()),
    "-f", "status_test=false",
    "-f", ("recollect_all=" + $RecollectAll.IsPresent.ToString().ToLowerInvariant()),
    "-f", ("metadata_only=" + $MetadataOnly.IsPresent.ToString().ToLowerInvariant())
  )
  Invoke-Checked "gh" $args

  if (-not $NoWatch) {
    $latest = gh run list --repo $Repo --workflow "cron-daily-collect.yml" --limit 1 --json databaseId --jq ".[0].databaseId"
    if ($latest) {
      Write-Host "[recovery] watching run $latest"
      Invoke-Checked "gh" @("run", "watch", $latest, "--repo", $Repo, "--exit-status")
      Write-Host "[recovery] run url: https://github.com/$Repo/actions/runs/$latest"
    }
  }
  exit 0
}

$loaded = Import-RecoveryEnv -RepoRoot $repoRoot
if ($loaded.Count -gt 0) {
  Write-Host ("[recovery] loaded env files: " + (($loaded | ForEach-Object { Split-Path $_ -Leaf }) -join ", "))
} else {
  Write-Host "[recovery] no local env file loaded"
}

Require-Env @("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY")

$outDir = Join-Path $repoRoot "scratchpad"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$queueFile = Join-Path $outDir ("view_missing_queue_{0}.json" -f $Date)

Invoke-Checked "py" @("-3", "scripts/build_view_missing_queue.py", "--date", $Date, "--out-dir", $outDir)
Write-Host "[recovery] queue file: $queueFile"

if ($Mode -eq "check") {
  Write-Host "[recovery] check completed without collection"
  exit 0
}

Require-Env @("APIFY_API_TOKEN")

[Environment]::SetEnvironmentVariable("MONITORING_DATE", $Date, "Process")
[Environment]::SetEnvironmentVariable("VIEW_MISSING_QUEUE_FILE", $queueFile, "Process")
[Environment]::SetEnvironmentVariable("VIEW_MISSING_TARGET_ONLY", $(if ($RecollectAll) { "0" } else { "1" }), "Process")
[Environment]::SetEnvironmentVariable("RECOLLECT_ALL", $(if ($RecollectAll) { "1" } else { "0" }), "Process")
[Environment]::SetEnvironmentVariable("PYTHONUNBUFFERED", "1", "Process")

Write-Host "[recovery] starting local run_monitoring.py"
Invoke-Checked "py" @("-3", "scripts/run_monitoring.py")
Write-Host "[recovery] local collection completed"
