param(
  [string]$Configuration = "release"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$targetDir = Join-Path $root "src-tauri\target\$Configuration"
$portableRoot = Join-Path $root "release\GalaxyAIHub-portable"
$zipPath = Join-Path $root "release\GalaxyAIHub-portable.zip"
$voiceRuntimeZipPath = Join-Path $root "release\GalaxyAIHub-voice-runtime-win64.zip"

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

  # Do not bundle heavyweight engines in the portable starter package.
  # First-start setup downloads the right runtime for the user's PC and can repair missing files later.
  New-Item -ItemType Directory -Path (Join-Path $portableRoot "src-tauri\engine") -Force | Out-Null

  $voiceTtsBinSource = Join-Path $root "assistant-runtime\voice-tts\bin"
  if (Test-Path $voiceTtsBinSource) {
    $voiceTtsBinDest = Join-Path $portableRoot "assistant-runtime\voice-tts\bin"
    New-Item -ItemType Directory -Path $voiceTtsBinDest -Force | Out-Null
    Get-ChildItem -Path $voiceTtsBinSource -File |
      Where-Object {
        $_.Extension -ieq ".dll" -or $_.Name -ieq "omnivoice-tts.exe"
      } |
      ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination $voiceTtsBinDest -Force
      }

    $libompSource = Join-Path $root "src-tauri\engine\libomp140.x86_64.dll"
    if ((-not (Test-Path (Join-Path $voiceTtsBinDest "libomp140.x86_64.dll"))) -and (Test-Path $libompSource)) {
      Copy-Item -LiteralPath $libompSource -Destination $voiceTtsBinDest -Force
    }

    $requiredVoiceRuntimeFiles = @(
      "omnivoice-tts.exe",
      "ggml.dll",
      "ggml-base.dll",
      "ggml-cpu.dll",
      "ggml-cuda.dll",
      "libomp140.x86_64.dll"
    )
    foreach ($fileName in $requiredVoiceRuntimeFiles) {
      $runtimeFile = Join-Path $voiceTtsBinDest $fileName
      if (-not (Test-Path $runtimeFile)) {
        throw "Portable voice runtime is incomplete. Missing $fileName"
      }
    }

    if (Test-Path $voiceRuntimeZipPath) {
      Remove-Item -LiteralPath $voiceRuntimeZipPath -Force
    }
    Compress-Archive -Path (Join-Path $voiceTtsBinDest "*") -DestinationPath $voiceRuntimeZipPath -Force
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

  New-Item -ItemType Directory -Path (Join-Path $portableRoot "bin") -Force | Out-Null

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
