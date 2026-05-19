param(
  [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetDir = Join-Path $root "src-tauri\target\$Configuration"
$portableRoot = Join-Path $root "release\GalaxyAIHub-portable"
$zipPath = Join-Path $root "release\GalaxyAIHub-portable.zip"

Push-Location $root
try {
  npm run tauri build

  $exe = Get-ChildItem -Path $targetDir -Filter "*.exe" -File |
    Where-Object { $_.Name -notmatch "build-script|deps" } |
    Sort-Object Length -Descending |
    Select-Object -First 1

  if (-not $exe) {
    throw "Could not find the built app exe in $targetDir"
  }

  if (Test-Path $portableRoot) {
    Remove-Item -LiteralPath $portableRoot -Recurse -Force
  }
  New-Item -ItemType Directory -Path $portableRoot | Out-Null

  Copy-Item -LiteralPath $exe.FullName -Destination (Join-Path $portableRoot "Galaxy AI Hub.exe")
  Copy-Item -LiteralPath (Join-Path $root "README.md") -Destination (Join-Path $portableRoot "README.md") -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $root "Logo") -Destination (Join-Path $portableRoot "Logo") -Recurse -ErrorAction SilentlyContinue

  $engineSource = Join-Path $root "src-tauri\engine"
  if (Test-Path $engineSource) {
    $engineDest = Join-Path $portableRoot "src-tauri\engine"
    New-Item -ItemType Directory -Path $engineDest -Force | Out-Null
    Get-ChildItem -Path $engineSource -File |
      Where-Object { $_.Name -match '\.(exe|dll|txt)$' } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $engineDest -Force
      }
  }

  $samplesSource = Join-Path $root "assistant-runtime\voice\voice_samples"
  if (Test-Path $samplesSource) {
    $samplesDest = Join-Path $portableRoot "assistant-runtime\voice\voice_samples"
    New-Item -ItemType Directory -Path $samplesDest -Force | Out-Null
    Get-ChildItem -Path $samplesSource -Filter "*.wav" -File |
      Where-Object {
        $_.Name -notmatch "^(celeb_|host_|utuber_)" -and
        $_.Name -notin @("en_Trump.wav", "en_David_Attenborough.wav")
      } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $samplesDest -Force
      }
  }

  $imageRuntimeSource = Join-Path $root "bin\stable-diffusion"
  if (Test-Path $imageRuntimeSource) {
    $imageRuntimeDest = Join-Path $portableRoot "bin\stable-diffusion"
    New-Item -ItemType Directory -Path $imageRuntimeDest -Force | Out-Null
    Copy-Item -LiteralPath $imageRuntimeSource -Destination (Join-Path $portableRoot "bin") -Recurse -Force
  }

  New-Item -ItemType Directory -Path (Join-Path $portableRoot "assistant-runtime") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $portableRoot "config") -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $portableRoot "logs") -Force | Out-Null

  if (Test-Path $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  Compress-Archive -Path (Join-Path $portableRoot "*") -DestinationPath $zipPath -Force

  Write-Host "Portable package created:"
  Write-Host $zipPath
}
finally {
  Pop-Location
}
