# One-click local start on Windows: PostgreSQL in Docker, dependencies, database migrations, backend + frontend.
# Run with start-dev.cmd (double-click) from the project root.
$ErrorActionPreference = 'Continue'  # native tools write progress to stderr; exit codes are checked instead
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
Start-Transcript -Path (Join-Path $root 'start-dev.log') -Force | Out-Null

function Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
try {
  Step 'Checking Docker'
  docker info --format '{{.ServerVersion}}' | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop and try again.' }

  Step 'Starting PostgreSQL (docker compose)'
  docker compose up -d db | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'docker compose failed (is port 5432 already used by another PostgreSQL?).' }
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    docker compose exec -T db pg_isready -U healtrip -d healtrip 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $ready) { throw 'PostgreSQL did not become ready in 60 seconds.' }
  Write-Host 'PostgreSQL is ready.'

  Step 'Configuring .env'
  $envFile = Join-Path $root '.env'
  if (-not (Test-Path $envFile)) { node scripts/setup-env.mjs | Out-Host }
  $lines = Get-Content $envFile
  $url = 'DATABASE_URL=postgres://healtrip:healtrip@localhost:5432/healtrip'
  if ($lines -match '^DATABASE_URL=\S') { Write-Host 'DATABASE_URL already set (kept as is).' }
  else {
    $lines = @($lines | Where-Object { $_ -notmatch '^DATABASE_URL=' -and $_ -notmatch '^DATABASE_SSL=' }) + $url + 'DATABASE_SSL=false'
    [IO.File]::WriteAllLines($envFile, [string[]]$lines)  # UTF-8 without BOM
    Write-Host 'Added DATABASE_URL for the local Docker database.'
  }

  Step 'Installing dependencies (npm install)'
  npm install --no-audit --no-fund | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }

  Step 'Creating tables and loading sample data'
  npm run db:migrate | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'Database migration failed.' }

  Step 'Starting backend and frontend in new windows'
  Start-Process cmd -ArgumentList '/k', 'title HealTrip backend && npm run dev:backend' -WorkingDirectory $root
  Start-Sleep -Seconds 6
  Start-Process cmd -ArgumentList '/k', 'title HealTrip frontend && npm run dev:frontend' -WorkingDirectory $root
  Start-Sleep -Seconds 8
  Start-Process 'http://localhost:5173'
  Write-Host "`nDone. Backend: http://localhost:3001  Frontend: http://localhost:5173" -ForegroundColor Green
  Write-Host 'Stop the app by closing the two windows. Stop the database with: npm run db:down'
} catch {
  Write-Host "`nSETUP FAILED: $($_.Exception.Message)" -ForegroundColor Red
} finally { Stop-Transcript | Out-Null }
