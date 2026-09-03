function Merge-LocalApiAllowedOrigins(
  [string[]]$Origins,
  [scriptblock]$CanonicalizeOrigin
) {
  $mergedOrigins = New-Object "System.Collections.Generic.List[string]"
  foreach ($originCandidate in @($Origins)) {
    $canonicalOrigin = & $CanonicalizeOrigin $originCandidate
    if (-not $mergedOrigins.Contains($canonicalOrigin)) {
      [void]$mergedOrigins.Add($canonicalOrigin)
    }
  }
  return $mergedOrigins.ToArray()
}
