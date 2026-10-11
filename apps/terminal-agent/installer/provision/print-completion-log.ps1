# Enables Microsoft-Windows-PrintService/Operational for print-completion evidence.
# Dot-source this file. It does not change the machine until a function runs.
# Windows PowerShell 5.1. ASCII only.
#
# The Agent reads event 307 from this log to tell that a print job finished.
# Windows leaves the log disabled until an administrator enables it.
# Configuration uses System.Diagnostics.Eventing.Reader.EventLogConfiguration.
# Setting the size and overwrite mode does not delete records already stored.
# A second run that finds the same settings writes nothing.
#
# There is no disable function. Uninstall must not turn this log off or empty it.
# The log ships with Windows, and other software may be using it.

$ErrorActionPreference = "Stop"

function Enable-PrintCompletionLog {
  $logName = "Microsoft-Windows-PrintService/Operational"
  $maxBytes = 4194304
  $circular = [System.Diagnostics.Eventing.Reader.EventLogMode]::Circular
  $config = New-Object -TypeName System.Diagnostics.Eventing.Reader.EventLogConfiguration -ArgumentList $logName
  try {
    $changed = $false
    if (-not $config.IsEnabled) {
      $config.IsEnabled = $true
      $changed = $true
    }
    if ([int64]$config.MaximumSizeInBytes -ne $maxBytes) {
      $config.MaximumSizeInBytes = $maxBytes
      $changed = $true
    }
    if ($config.LogMode -ne $circular) {
      $config.LogMode = $circular
      $changed = $true
    }
    if ($changed) {
      $config.SaveChanges()
    }
  } finally {
    $config.Dispose()
  }

  $readback = New-Object -TypeName System.Diagnostics.Eventing.Reader.EventLogConfiguration -ArgumentList $logName
  try {
    if (-not $readback.IsEnabled) {
      throw "PrintService Operational log readback was not enabled"
    }
    if ([int64]$readback.MaximumSizeInBytes -ne $maxBytes) {
      throw "PrintService Operational log readback size was $($readback.MaximumSizeInBytes)"
    }
    if ($readback.LogMode -ne $circular) {
      throw "PrintService Operational log readback was not overwrite"
    }
  } finally {
    $readback.Dispose()
  }
}

function Get-PrintCompletionLogStatusLine {
  $enabled = "unknown"
  $maxBytes = "unknown"
  $retention = "unknown"
  try {
    $config = New-Object -TypeName System.Diagnostics.Eventing.Reader.EventLogConfiguration -ArgumentList "Microsoft-Windows-PrintService/Operational"
    try {
      if ($config.IsEnabled) { $enabled = "true" } else { $enabled = "false" }
      $maxBytes = [string]([int64]$config.MaximumSizeInBytes)
      if ($config.LogMode -eq [System.Diagnostics.Eventing.Reader.EventLogMode]::Circular) {
        $retention = "overwrite"
      } else {
        $retention = "other"
      }
    } finally {
      $config.Dispose()
    }
  } catch {
    $enabled = "unknown"
    $maxBytes = "unknown"
    $retention = "unknown"
  }
  return "print-completion-log: enabled=$enabled maxBytes=$maxBytes retention=$retention"
}
