#!/usr/bin/env pwsh
[CmdletBinding()]
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]] $DeployArgs
)

$candidates = @(
  (Get-Command bash -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  "$env:ProgramFiles\Git\bin\bash.exe",
  "${env:ProgramFiles(x86)}\Git\bin\bash.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $candidates) {
  throw "未找到 Git Bash。请安装 Git for Windows，或直接运行：& 'C:\Program Files\Git\bin\bash.exe' scripts/deploy-off.sh"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$script = Join-Path $repoRoot 'scripts/deploy-off.sh'
$bashPath = [string]@($candidates)[0]
& $bashPath $script @DeployArgs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
