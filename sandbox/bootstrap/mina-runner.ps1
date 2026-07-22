$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SourceRoot = 'C:\Mina\src'
$OutRoot = 'C:\Mina\out'
$BootstrapRoot = 'C:\Mina\bootstrap'
$EventPath = Join-Path $OutRoot 'events.jsonl'
$ReceiptPath = Join-Path $OutRoot 'guest-receipt.json'
$script:OutputBytes = 0L
$script:OutputExceeded = $false
$script:Sync = New-Object object

function Assert-Within([string] $Root, [string] $Candidate, [string] $Category) {
  $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
  $candidatePath = [IO.Path]::GetFullPath($Candidate)
  if (-not $candidatePath.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw $Category
  }
  return $candidatePath
}

function Write-Event([hashtable] $Event) {
  $line = $Event | ConvertTo-Json -Compress -Depth 8
  $bytes = [Text.Encoding]::UTF8.GetByteCount($line)
  if ($bytes -gt 65535) { throw 'sandbox_stream_line_too_large' }
  [Threading.Monitor]::Enter($script:Sync)
  try {
    [IO.File]::AppendAllText($EventPath, $line + "`n", (New-Object Text.UTF8Encoding($false)))
  } finally {
    [Threading.Monitor]::Exit($script:Sync)
  }
}

function Write-TextEvent([string] $Type, [string] $Text, [long] $Limit) {
  if ($null -eq $Text) { return }
  for ($offset = 0; $offset -lt $Text.Length; $offset += 16000) {
    $length = [Math]::Min(16000, $Text.Length - $offset)
    $chunk = $Text.Substring($offset, $length)
    $size = [Text.Encoding]::UTF8.GetByteCount($chunk)
    [Threading.Monitor]::Enter($script:Sync)
    try {
      if (($script:OutputBytes + $size) -gt $Limit) {
        $script:OutputExceeded = $true
        return
      }
      $script:OutputBytes += $size
    } finally {
      [Threading.Monitor]::Exit($script:Sync)
    }
    Write-Event @{ type = $Type; text = $chunk }
  }
}

function Quote-Argument([string] $Value) {
  if ($Value -notmatch '[\s"]') { return $Value }
  return '"' + ([regex]::Replace($Value, '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"'
}

function Stop-Tree([int] $ProcessId) {
  & "$env:SystemRoot\System32\taskkill.exe" /PID $ProcessId /T /F 2>$null | Out-Null
}

try {
  if (Test-Path -LiteralPath $EventPath) { Remove-Item -LiteralPath $EventPath -Force }
  $jobPath = Join-Path $SourceRoot 'job.json'
  $manifestPath = Join-Path $BootstrapRoot 'runtime-manifest.json'
  $job = Get-Content -LiteralPath $jobPath -Raw -Encoding UTF8 | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json

  if ($job.network -ne $false) { throw 'sandbox_network_forbidden' }
  if ($job.jobId -notmatch '^[a-z0-9][a-z0-9-]{0,100}$') { throw 'sandbox_job_id_invalid' }
  if ($job.limits.wallMs -lt 1 -or $job.limits.wallMs -gt 300000) { throw 'sandbox_wall_limit_invalid' }
  if ($job.limits.memoryMiB -lt 1 -or $job.limits.memoryMiB -gt 1024) { throw 'sandbox_memory_limit_invalid' }
  if ($job.limits.outputBytes -lt 1 -or $job.limits.outputBytes -gt 10485760) { throw 'sandbox_output_limit_invalid' }

  foreach ($source in $job.sourceFiles) {
    $sourcePath = Assert-Within $SourceRoot (Join-Path $SourceRoot ($source.path -replace '/', '\')) 'sandbox_source_escape'
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw 'sandbox_source_missing' }
    $actual = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
    if (('sha256:' + $actual) -ne $source.digest) { throw 'sandbox_source_digest_mismatch' }
  }

  $runtime = @($manifest.runtimes | Where-Object { $_.language -eq $job.language })
  if ($runtime.Count -ne 1) { throw 'sandbox_runtime_missing' }
  $runtimePath = Assert-Within $BootstrapRoot (Join-Path $BootstrapRoot ($runtime[0].path -replace '/', '\')) 'sandbox_runtime_escape'
  $runtimeDigest = (Get-FileHash -LiteralPath $runtimePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($runtimeDigest -ne $runtime[0].sha256) { throw 'sandbox_runtime_digest_mismatch' }
  $entrypoint = Assert-Within $SourceRoot (Join-Path $SourceRoot ($job.entrypoint -replace '/', '\')) 'sandbox_entrypoint_escape'

  $arguments = @()
  switch ($job.language) {
    'python' { $arguments += @('-I', '-B', $entrypoint) }
    'javascript' { $arguments += @('--disable-proto=throw', $entrypoint) }
    'powershell' { $arguments += @('-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned', '-File', $entrypoint) }
    default { throw 'sandbox_language_invalid' }
  }
  foreach ($argument in $job.args) {
    if ($argument -isnot [string] -or $argument.Length -gt 2000 -or $argument.Contains([char]0)) { throw 'sandbox_argument_invalid' }
    $arguments += $argument
  }

  $info = New-Object Diagnostics.ProcessStartInfo
  $info.FileName = $runtimePath
  $info.Arguments = (($arguments | ForEach-Object { Quote-Argument $_ }) -join ' ')
  $info.WorkingDirectory = $SourceRoot
  $info.UseShellExecute = $false
  $info.CreateNoWindow = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $process = New-Object Diagnostics.Process
  $process.StartInfo = $info
  $process.EnableRaisingEvents = $true
  $process.add_OutputDataReceived({ param($sender, $event) Write-TextEvent 'stdout' $event.Data $job.limits.outputBytes })
  $process.add_ErrorDataReceived({ param($sender, $event) Write-TextEvent 'stderr' $event.Data $job.limits.outputBytes })

  Write-Event @{ type = 'started'; jobId = $job.jobId; at = [DateTime]::UtcNow.ToString('o') }
  if (-not $process.Start()) { throw 'sandbox_process_start_failed' }
  $process.BeginOutputReadLine()
  $process.BeginErrorReadLine()
  $watch = [Diagnostics.Stopwatch]::StartNew()
  $memoryPeak = 0L
  while (-not $process.HasExited) {
    Start-Sleep -Milliseconds 25
    $process.Refresh()
    $memoryPeak = [Math]::Max($memoryPeak, $process.WorkingSet64)
    if ($script:OutputExceeded) { Stop-Tree $process.Id; throw 'sandbox_output_limit_exceeded' }
    if ($memoryPeak -gt ([long]$job.limits.memoryMiB * 1MB)) { Stop-Tree $process.Id; throw 'sandbox_memory_limit_exceeded' }
    if ($watch.ElapsedMilliseconds -gt $job.limits.wallMs) { Stop-Tree $process.Id; throw 'sandbox_wall_time_exceeded' }
  }
  $process.WaitForExit()
  $watch.Stop()
  Write-Event @{ type = 'usage'; cpuMs = [Math]::Round($process.TotalProcessorTime.TotalMilliseconds); memoryPeakMiB = [Math]::Round($memoryPeak / 1MB, 2) }

  $artifacts = @()
  foreach ($export in $job.exports) {
    $artifactPath = Assert-Within $OutRoot (Join-Path $OutRoot (($export -replace '^out/', '') -replace '/', '\')) 'sandbox_artifact_escape'
    if (Test-Path -LiteralPath $artifactPath -PathType Leaf) {
      $item = Get-Item -LiteralPath $artifactPath
      $hash = (Get-FileHash -LiteralPath $artifactPath -Algorithm SHA256).Hash.ToLowerInvariant()
      $artifact = @{ type = 'artifact'; artifactId = ('artifact-' + $artifacts.Count); path = $export; digest = ('sha256:' + $hash); bytes = $item.Length }
      $artifacts += $artifact
      Write-Event $artifact
    }
  }

  Write-Event @{ type = 'completed'; exitCode = $process.ExitCode }
  $eventDigest = (Get-FileHash -LiteralPath $EventPath -Algorithm SHA256).Hash.ToLowerInvariant()
  $receipt = @{
    schemaVersion = 1
    jobId = $job.jobId
    sourceDigest = $job.sourceDigest
    exitCode = $process.ExitCode
    completedAt = [DateTime]::UtcNow.ToString('o')
    eventLogDigest = ('sha256:' + $eventDigest)
    artifacts = $artifacts
    signatureState = 'awaiting_host_signature'
  }
  $receipt | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $ReceiptPath -Encoding UTF8
  exit $process.ExitCode
} catch {
  try { Write-Event @{ type = 'failed'; category = 'sandbox_guest_failure'; message = $_.Exception.Message } } catch {}
  exit 1
}
