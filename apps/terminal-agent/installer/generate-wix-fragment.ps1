[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$StagingRoot,
  [Parameter(Mandatory = $true)][string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedStaging = (Resolve-Path -LiteralPath $StagingRoot).Path.TrimEnd("\")
$excluded = @(
  "bootstrap/aijobprintagent.exe",
  "bootstrap/aijobprintagent.xml",
  "provision/provision-installed-agent.ps1",
  "provision/provision-terminal.cmd",
  "provision/install-production-agent.ps1",
  "provision/service-identity.ps1"
)

function Get-StableId([string]$Prefix, [string]$Value) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value.ToLowerInvariant())
    $hash = $sha.ComputeHash($bytes)
    $suffix = (($hash[0..11] | ForEach-Object { $_.ToString("x2") }) -join "")
    return "${Prefix}_${suffix}"
  } finally {
    $sha.Dispose()
  }
}

function New-TreeNode([string]$Name, [string]$RelativePath) {
  return [pscustomobject]@{
    Name = $Name
    RelativePath = $RelativePath
    Children = @{}
    Files = [System.Collections.Generic.List[object]]::new()
  }
}

$tree = New-TreeNode -Name "" -RelativePath ""
$files = @(Get-ChildItem -Recurse -File -LiteralPath $resolvedStaging | Sort-Object FullName | Where-Object {
  $relative = $_.FullName.Substring($resolvedStaging.Length + 1).Replace("\", "/")
  $excluded -notcontains $relative
})

foreach ($file in $files) {
  $relative = $file.FullName.Substring($resolvedStaging.Length + 1).Replace("\", "/")
  $segments = $relative.Split("/")
  $node = $tree
  $directoryParts = [System.Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt ($segments.Length - 1); $index++) {
    $directoryParts.Add($segments[$index])
    $directoryPath = $directoryParts -join "/"
    if (-not $node.Children.ContainsKey($segments[$index])) {
      $node.Children[$segments[$index]] = New-TreeNode -Name $segments[$index] -RelativePath $directoryPath
    }
    $node = $node.Children[$segments[$index]]
  }
  $node.Files.Add([pscustomobject]@{ FullName = $file.FullName; RelativePath = $relative })
}

$settings = [System.Xml.XmlWriterSettings]::new()
$settings.Indent = $true
$settings.Encoding = [System.Text.UTF8Encoding]::new($false)
$writer = [System.Xml.XmlWriter]::Create($OutputPath, $settings)
$componentIds = [System.Collections.Generic.List[string]]::new()

function Write-Node([object]$Node, [System.Xml.XmlWriter]$XmlWriter, [System.Collections.Generic.List[string]]$Ids) {
  $openedDirectory = -not [string]::IsNullOrEmpty($Node.RelativePath)
  if ($openedDirectory) {
    $XmlWriter.WriteStartElement("Directory")
    $XmlWriter.WriteAttributeString("Id", (Get-StableId -Prefix "D" -Value $Node.RelativePath))
    $XmlWriter.WriteAttributeString("Name", $Node.Name)
  }

  foreach ($file in $Node.Files) {
    $componentId = Get-StableId -Prefix "C" -Value $file.RelativePath
    $fileId = Get-StableId -Prefix "F" -Value $file.RelativePath
    $Ids.Add($componentId)
    $XmlWriter.WriteStartElement("Component")
    $XmlWriter.WriteAttributeString("Id", $componentId)
    $XmlWriter.WriteAttributeString("Guid", "*")
    $XmlWriter.WriteAttributeString("Bitness", "always64")
    $XmlWriter.WriteStartElement("File")
    $XmlWriter.WriteAttributeString("Id", $fileId)
    $XmlWriter.WriteAttributeString("Source", $file.FullName)
    $XmlWriter.WriteAttributeString("KeyPath", "yes")
    $XmlWriter.WriteAttributeString("Checksum", "yes")
    $XmlWriter.WriteEndElement()
    $XmlWriter.WriteEndElement()
  }

  foreach ($child in @($Node.Children.Values | Sort-Object Name)) {
    Write-Node -Node $child -XmlWriter $XmlWriter -Ids $Ids
  }
  if ($openedDirectory) {
    $XmlWriter.WriteEndElement()
  }
}

try {
  $writer.WriteStartDocument()
  $writer.WriteStartElement("Wix", "http://wixtoolset.org/schemas/v4/wxs")
  $writer.WriteStartElement("Fragment")
  $writer.WriteStartElement("DirectoryRef")
  $writer.WriteAttributeString("Id", "INSTALLFOLDER")
  Write-Node -Node $tree -XmlWriter $writer -Ids $componentIds
  $writer.WriteEndElement()
  $writer.WriteStartElement("ComponentGroup")
  $writer.WriteAttributeString("Id", "AgentPayload")
  foreach ($componentId in $componentIds) {
    $writer.WriteStartElement("ComponentRef")
    $writer.WriteAttributeString("Id", $componentId)
    $writer.WriteEndElement()
  }
  $writer.WriteEndElement()
  $writer.WriteEndElement()
  $writer.WriteEndElement()
  $writer.WriteEndDocument()
} finally {
  $writer.Dispose()
}

Write-Host "WIX_FRAGMENT_READY path=$OutputPath components=$($componentIds.Count)"
