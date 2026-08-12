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

function Assert-RestrictedRuntime([string]$Root) {
  if ([string]::IsNullOrWhiteSpace($Root)) {
    throw "Restricted runtime check requires a non-empty path"
  }

  $rootItem = Get-Item -Force -LiteralPath $Root -ErrorAction Stop
  $pending = New-Object "System.Collections.Generic.Queue[System.IO.FileSystemInfo]"
  $pending.Enqueue($rootItem)
  $allowedSids = @("S-1-5-18", "S-1-5-32-544")

  while ($pending.Count -gt 0) {
    $item = $pending.Dequeue()
    Assert-NotReparsePoint $item

    $acl = Get-Acl -LiteralPath $item.FullName -ErrorAction Stop
    $ownerSid = ConvertTo-SidValue $acl.Owner
    if ($allowedSids -notcontains $ownerSid) {
      throw "Runtime owner must be SYSTEM or Administrators: $($item.FullName)"
    }

    foreach ($rule in @($acl.Access)) {
      if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) {
        continue
      }
      $sid = ConvertTo-SidValue $rule.IdentityReference
      if ($allowedSids -notcontains $sid -and (Test-WriteLikeFileSystemRights $rule.FileSystemRights)) {
        throw "Runtime grants write-like access to a non-privileged principal: $($item.FullName)"
      }
    }

    if ($item.PSIsContainer) {
      foreach ($child in @(Get-ChildItem -Force -LiteralPath $item.FullName -ErrorAction Stop)) {
        $pending.Enqueue($child)
      }
    }
  }
}
