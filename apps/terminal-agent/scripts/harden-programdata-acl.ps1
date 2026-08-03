# AI Job Print Terminal — ProgramData ACL harden (Gate 0.4 field repair)
#
# Admin-only. Does not contact the API, rewrite agent.token ciphertext, restart
# the service, or print/claim tasks. Re-applies the same SYSTEM+Administrators
# ACL used by install-production-agent.ps1.

[CmdletBinding()]
param(
  [string]$ProgramDataDir = (Join-Path $env:ProgramData "AIJobPrintAgent")
)

$ErrorActionPreference = "Stop"

function Set-ProgramDataAcl([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    throw "Set-ProgramDataAcl requires a non-empty path"
  }

  $item = Get-Item -LiteralPath $Path -ErrorAction Stop
  $isContainer = [bool]$item.PSIsContainer
  if ($isContainer) {
    $acl = New-Object System.Security.AccessControl.DirectorySecurity
    $inherit = [System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor `
      [System.Security.AccessControl.InheritanceFlags]::ObjectInherit
  } else {
    $acl = New-Object System.Security.AccessControl.FileSecurity
    $inherit = [System.Security.AccessControl.InheritanceFlags]::None
  }

  $acl.SetAccessRuleProtection($true, $false)
  $rights = [System.Security.AccessControl.FileSystemRights]::FullControl
  $propagation = [System.Security.AccessControl.PropagationFlags]::None
  $allow = [System.Security.AccessControl.AccessControlType]::Allow
  foreach ($sidValue in @("S-1-5-18", "S-1-5-32-544")) {
    $sid = New-Object System.Security.Principal.SecurityIdentifier($sidValue)
    $rule = New-Object System.Security.AccessControl.FileSystemAccessRule(
      $sid,
      $rights,
      $inherit,
      $propagation,
      $allow
    )
    $acl.AddAccessRule($rule)
  }

  Set-Acl -LiteralPath $Path -AclObject $acl
}

function Get-ProgramDataAclReport([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return [pscustomobject]@{ status = "unavailable"; reason = "unavailable" }
  }
  if (-not (Test-Path -LiteralPath $Path)) {
    return [pscustomobject]@{ status = "missing"; reason = "missing" }
  }

  try {
    $acl = Get-Acl -LiteralPath $Path
    if (-not $acl.AreAccessRulesProtected) {
      return [pscustomobject]@{ status = "too_permissive"; reason = "inheritance_enabled" }
    }

    $required = @("S-1-5-18", "S-1-5-32-544")
    $forbidden = @("S-1-1-0", "S-1-5-11", "S-1-5-32-545")
    $allowSids = New-Object "System.Collections.Generic.HashSet[string]"

    foreach ($rule in $acl.Access) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
        continue
      }

      try {
        $sid = ([System.Security.Principal.NTAccount]$rule.IdentityReference).Translate(
          [System.Security.Principal.SecurityIdentifier]
        ).Value
      } catch {
        if ($rule.IdentityReference -is [System.Security.Principal.SecurityIdentifier]) {
          $sid = [string]$rule.IdentityReference.Value
        } else {
          return [pscustomobject]@{ status = "unexpected"; reason = "unexpected_principal" }
        }
      }

      [void]$allowSids.Add($sid)
      if ($forbidden -contains $sid) {
        return [pscustomobject]@{ status = "too_permissive"; reason = "forbidden_principal" }
      }
    }

    foreach ($sid in $required) {
      if (-not $allowSids.Contains($sid)) {
        return [pscustomobject]@{ status = "unexpected"; reason = "missing_required" }
      }
    }

    foreach ($sid in $allowSids) {
      if ($required -notcontains $sid) {
        return [pscustomobject]@{ status = "unexpected"; reason = "unexpected_principal" }
      }
    }

    return [pscustomobject]@{ status = "ok"; reason = "ok" }
  } catch {
    return [pscustomobject]@{ status = "unavailable"; reason = "unavailable" }
  }
}

if (-not (Test-Path -LiteralPath $ProgramDataDir -PathType Container)) {
  throw "ProgramData directory not found: $ProgramDataDir"
}

$tokenPath = Join-Path $ProgramDataDir "agent.token"
Set-ProgramDataAcl -Path $ProgramDataDir
if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
  Set-ProgramDataAcl -Path $tokenPath
}

$dirReport = Get-ProgramDataAclReport $ProgramDataDir
$tokenReport = if (Test-Path -LiteralPath $tokenPath -PathType Leaf) {
  Get-ProgramDataAclReport $tokenPath
} else {
  [pscustomobject]@{ status = "missing"; reason = "missing" }
}

[pscustomobject]@{
  programDataDir = $ProgramDataDir
  tokenPath = $tokenPath
  programDataAclStatus = $dirReport.status
  programDataAclReason = $dirReport.reason
  tokenFileAclStatus = $tokenReport.status
  tokenFileAclReason = $tokenReport.reason
  hardened = ($dirReport.status -eq "ok" -and ($tokenReport.status -eq "ok" -or $tokenReport.status -eq "missing"))
}
