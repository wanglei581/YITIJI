# AI Job Print Terminal — Windows service identity helper
#
# node-windows may register a service whose SCM Name follows the wrapper
# executable (for example, aijobprintagent.exe) while the operator-facing
# DisplayName remains AIJobPrintAgent. Resolve both forms before mutating or
# reporting a service.

function Resolve-AgentService {
  [CmdletBinding()]
  param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Identity
  )

  $candidates = @(
    Get-CimInstance Win32_Service -ErrorAction Stop | Where-Object {
      $_.Name -eq $Identity -or $_.DisplayName -eq $Identity
    }
  )

  if ($candidates.Count -gt 1) {
    $exception = [System.InvalidOperationException]::new(
      "Multiple Windows services match '$Identity'; refusing to choose one."
    )
    $exception.Data["agentServiceResolution"] = "ambiguous"
    throw $exception
  }

  if ($candidates.Count -eq 0) {
    return $null
  }

  return $candidates[0]
}
