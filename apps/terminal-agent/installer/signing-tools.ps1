$ErrorActionPreference = "Stop"

function Fail-SigningTool([string]$Message) {
  throw "WINDOWS_INSTALLER_SIGNING_FAILED: $Message"
}

function Resolve-SignTool([string]$ExplicitPath) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
      Fail-SigningTool "signtool.exe was not found at '$ExplicitPath'."
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  $command = Get-Command signtool.exe -ErrorAction SilentlyContinue
  if ($null -ne $command) {
    return $command.Source
  }

  $sdkRoot = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
  if (-not (Test-Path -LiteralPath $sdkRoot -PathType Container)) {
    Fail-SigningTool "Windows SDK bin directory was not found at '$sdkRoot'."
  }

  $candidates = @(Get-ChildItem -LiteralPath $sdkRoot -Filter signtool.exe -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "\\x64\\signtool\.exe$" } |
    ForEach-Object {
      $versionText = $_.Directory.Parent.Name
      $parsedVersion = [version]"0.0.0.0"
      $isVersioned = [version]::TryParse($versionText, [ref]$parsedVersion)
      [pscustomobject]@{
        Path = $_.FullName
        Version = $parsedVersion
        IsVersioned = $isVersioned
      }
    } |
    Sort-Object -Property @{ Expression = "IsVersioned"; Descending = $true }, @{ Expression = "Version"; Descending = $true }, @{ Expression = "Path"; Descending = $true })

  if ($candidates.Count -eq 0) {
    Fail-SigningTool "signtool.exe was not found. Install the Windows SDK or pass -SignToolPath."
  }
  return $candidates[0].Path
}

function Resolve-WixTool([string]$ExplicitPath) {
  if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
    if (-not (Test-Path -LiteralPath $ExplicitPath -PathType Leaf)) {
      Fail-SigningTool "WiX CLI was not found at '$ExplicitPath'."
    }
    return (Resolve-Path -LiteralPath $ExplicitPath).Path
  }

  foreach ($name in @("wix.exe", "wix")) {
    $command = Get-Command $name -ErrorAction SilentlyContinue
    if ($null -ne $command) {
      return $command.Source
    }
  }
  Fail-SigningTool "WiX CLI was not found. Install dotnet tool 'wix' 4.0.6 or pass -WixToolPath."
}

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory)][string]$FilePath,
    [Parameter(Mandatory)][string[]]$Arguments,
    [Parameter(Mandatory)][string]$FailureMessage
  )

  & $FilePath @Arguments | ForEach-Object { Write-Host $_ }
  if ($LASTEXITCODE -ne 0) {
    Fail-SigningTool "$FailureMessage Exit code: $LASTEXITCODE."
  }
}

function Get-FileRecord([string]$Path, [string]$Name) {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  $item = Get-Item -LiteralPath $resolved
  return [ordered]@{
    name = $Name
    bytes = [long]$item.Length
    sha256 = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToUpperInvariant()
  }
}

function Write-DetachedCmsSignature {
  param(
    [Parameter(Mandatory)][string]$ContentPath,
    [Parameter(Mandatory)][string]$SignaturePath,
    [Parameter(Mandatory)]$Certificate
  )

  Add-Type -AssemblyName System.Security
  $contentBytes = [System.IO.File]::ReadAllBytes($ContentPath)
  $contentInfo = [System.Security.Cryptography.Pkcs.ContentInfo]::new($contentBytes)
  $signedCms = [System.Security.Cryptography.Pkcs.SignedCms]::new($contentInfo, $true)
  $cmsSigner = [System.Security.Cryptography.Pkcs.CmsSigner]::new($Certificate)
  $cmsSigner.IncludeOption = [System.Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
  $signedCms.ComputeSignature($cmsSigner)
  [System.IO.File]::WriteAllBytes($SignaturePath, $signedCms.Encode())
}

function Get-ValidatedSigningCertificate {
  param(
    [Parameter(Mandatory)][string]$Thumbprint,
    [Parameter(Mandatory)][ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope
  )

  $normalized = ($Thumbprint -replace "\s", "").ToUpperInvariant()
  if ($normalized -notmatch "^[0-9A-F]{40}$") {
    Fail-SigningTool "Certificate thumbprint must be a 40-character SHA-1 thumbprint."
  }

  $certificate = Get-Item -LiteralPath "Cert:\$StoreScope\My\$normalized" -ErrorAction SilentlyContinue
  if ($null -eq $certificate) {
    Fail-SigningTool "Signing certificate $normalized was not found in Cert:\$StoreScope\My."
  }
  if (-not $certificate.HasPrivateKey) {
    Fail-SigningTool "Signing certificate $normalized has no accessible private key."
  }

  $now = Get-Date
  if ($now -lt $certificate.NotBefore -or $now -ge $certificate.NotAfter) {
    Fail-SigningTool "Signing certificate $normalized is outside its validity period."
  }

  $ekuExtensions = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.37" })
  $eku = @($ekuExtensions | ForEach-Object {
    $decoded = [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($_, $false)
    $decoded.EnhancedKeyUsages | ForEach-Object { $_.Value }
  })
  if ($eku -notcontains "1.3.6.1.5.5.7.3.3") {
    Fail-SigningTool "Signing certificate $normalized is missing the Code Signing EKU."
  }

  $keyUsageExtensions = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq "2.5.29.15" })
  if ($keyUsageExtensions.Count -gt 0) {
    $keyUsage = New-Object System.Security.Cryptography.X509Certificates.X509KeyUsageExtension($keyUsageExtensions[0], $false)
    if (($keyUsage.KeyUsages -band [System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature) -eq 0) {
      Fail-SigningTool "Signing certificate $normalized does not permit digital signatures."
    }
  }

  return $certificate
}

function Assert-UnsignedAuthenticode([string]$Path) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::NotSigned) {
    Fail-SigningTool "Input '$Path' must be unsigned, got Authenticode status $($signature.Status)."
  }
}

function Invoke-SignAuthenticode {
  param(
    [Parameter(Mandatory)][string]$SignToolPath,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)]$Certificate,
    [Parameter(Mandatory)][ValidateSet("CurrentUser", "LocalMachine")][string]$StoreScope,
    [string]$TimestampUrl
  )

  $arguments = @(
    "sign", "/v", "/fd", "SHA256", "/sha1", $Certificate.Thumbprint, "/s", "My",
    "/d", "AI Job Print Terminal Agent"
  )
  if ($StoreScope -eq "LocalMachine") {
    $arguments += "/sm"
  }
  if (-not [string]::IsNullOrWhiteSpace($TimestampUrl)) {
    $arguments += @("/tr", $TimestampUrl, "/td", "SHA256")
  }
  Invoke-CheckedCommand -FilePath $SignToolPath -Arguments ($arguments + $Path) -FailureMessage "signtool sign failed for '$Path'."
}

function Assert-ValidAuthenticode {
  param(
    [Parameter(Mandatory)][string]$SignToolPath,
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$ExpectedThumbprint,
    [switch]$RequireTimestamp
  )

  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid) {
    Fail-SigningTool "Authenticode validation failed for '$Path': $($signature.Status)."
  }
  if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ine $ExpectedThumbprint) {
    Fail-SigningTool "Unexpected signer for '$Path'."
  }
  if ($RequireTimestamp -and $null -eq $signature.TimeStamperCertificate) {
    Fail-SigningTool "A trusted timestamp is required for '$Path' but none was found."
  }

  $arguments = @("verify", "/pa", "/v")
  if ($RequireTimestamp) {
    $arguments += "/tw"
  }
  $arguments += $Path
  Invoke-CheckedCommand -FilePath $SignToolPath -Arguments $arguments -FailureMessage "signtool verify failed for '$Path'."
  return $signature
}

function Assert-DirectoryOutside([string]$CandidatePath, [string]$ProtectedDirectory, [string]$Description) {
  $candidate = [System.IO.Path]::GetFullPath($CandidatePath).TrimEnd('\', '/')
  $protected = [System.IO.Path]::GetFullPath($ProtectedDirectory).TrimEnd('\', '/')
  $prefix = $protected + [System.IO.Path]::DirectorySeparatorChar
  if ($candidate -eq $protected -or $candidate.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail-SigningTool "$Description must be outside '$protected'."
  }
}
