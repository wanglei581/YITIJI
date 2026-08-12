function ConvertTo-SidValue([object]$IdentityReference) {
  if ($IdentityReference -is [System.Security.Principal.SecurityIdentifier]) {
    return [string]$IdentityReference.Value
  }

  $account = if ($IdentityReference -is [System.Security.Principal.NTAccount]) {
    $IdentityReference
  } else {
    New-Object System.Security.Principal.NTAccount([string]$IdentityReference)
  }
  return [string]$account.Translate(
    [System.Security.Principal.SecurityIdentifier]
  ).Value
}

function Assert-NotReparsePoint([System.IO.FileSystemInfo]$Item) {
  if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    throw "Refusing filesystem reparse point: $($Item.FullName)"
  }
}

function Test-WriteLikeFileSystemRights([System.Security.AccessControl.FileSystemRights]$Rights) {
  # Do not use composite Write/Modify values in this mask: Modify includes ordinary
  # read/execute bits and would falsely reject the standard Program Files Users ACL.
  $writeLikeRights = [System.Security.AccessControl.FileSystemRights]::WriteData -bor `
    [System.Security.AccessControl.FileSystemRights]::AppendData -bor `
    [System.Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor `
    [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor `
    [System.Security.AccessControl.FileSystemRights]::WriteAttributes -bor `
    [System.Security.AccessControl.FileSystemRights]::Delete -bor `
    [System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor `
    [System.Security.AccessControl.FileSystemRights]::TakeOwnership
  return (($Rights -band $writeLikeRights) -ne 0)
}

function Test-FileSystemAccessRuleAppliesToItem([System.Security.AccessControl.FileSystemAccessRule]$Rule) {
  # Program Files commonly carries a CREATOR OWNER FullControl ACE marked
  # InheritOnly. It is a template for descendants and grants no access to the
  # item whose ACL we are currently evaluating. Descendants are still walked
  # recursively, so any inherited rule that becomes effective is checked there.
  return (($Rule.PropagationFlags -band [System.Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0)
}

function Test-IsPrivilegedRuntimeSid([string]$Sid) {
  # TrustedInstaller is the protected Windows Modules Installer service SID and
  # holds FullControl on Program Files by default. Keep this exact SID allowlist
  # narrow; arbitrary NT SERVICE identities are not privileged here.
  $privilegedSids = @(
    "S-1-5-18", # LocalSystem
    "S-1-5-32-544", # BUILTIN\Administrators
    "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464" # NT SERVICE\TrustedInstaller
  )
  return ($privilegedSids -contains $Sid)
}

function Assert-RestrictedRuntime([string]$Root) {
  if ([string]::IsNullOrWhiteSpace($Root)) {
    throw "Restricted runtime check requires a non-empty path"
  }

  $rootItem = Get-Item -Force -LiteralPath $Root -ErrorAction Stop
  $pending = New-Object "System.Collections.Generic.Queue[System.IO.FileSystemInfo]"
  $pending.Enqueue($rootItem)

  while ($pending.Count -gt 0) {
    $item = $pending.Dequeue()
    Assert-NotReparsePoint $item

    $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
    $ownerSid = ConvertTo-SidValue $acl.Owner
    if (-not (Test-IsPrivilegedRuntimeSid $ownerSid)) {
      throw "Runtime owner must be SYSTEM, Administrators, or TrustedInstaller: $($item.FullName)"
    }

    foreach ($rule in @($acl.Access)) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
        continue
      }
      if (-not (Test-FileSystemAccessRuleAppliesToItem $rule)) {
        continue
      }
      $sid = ConvertTo-SidValue $rule.IdentityReference
      if (-not (Test-IsPrivilegedRuntimeSid $sid) -and (Test-WriteLikeFileSystemRights $rule.FileSystemRights)) {
        throw "Runtime grants write-like access to non-privileged SID $sid ($($rule.FileSystemRights)): $($item.FullName)"
      }
    }

    if ($item.PSIsContainer) {
      foreach ($child in @(Get-ChildItem -Force -LiteralPath $item.FullName -ErrorAction Stop)) {
        $pending.Enqueue($child)
      }
    }
  }
}
