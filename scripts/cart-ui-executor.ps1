param(
  [Parameter(Mandatory = $true)]
  [string]$ProductUrl,

  [Parameter(Mandatory = $true)]
  [string]$ProductKey,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedProfileName,

  [Parameter(Mandatory = $true)]
  [string]$RetailerId,

  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

Add-Type -AssemblyName UIAutomationClient | Out-Null
Add-Type -AssemblyName UIAutomationTypes | Out-Null

Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class DealHunterWindows {
  public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool EnumWindows(EnumWindowsProc callback, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern bool IsWindowVisible(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

  [DllImport("user32.dll")]
  public static extern bool PostMessage(IntPtr hWnd, uint message, IntPtr wParam, IntPtr lParam);

  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool ShowWindowAsync(IntPtr hWnd, int command);

  [DllImport("user32.dll")]
  public static extern bool GetCursorPos(out POINT point);

  [DllImport("user32.dll")]
  public static extern bool SetCursorPos(int x, int y);

  [DllImport("user32.dll")]
  public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extraInfo);

  public struct POINT {
    public int X;
    public int Y;
  }
}
"@ | Out-Null

$script:ChromePath = "C:\Program Files\Google\Chrome\Application\chrome.exe"
$script:WmClose = 0x0010
$script:SwRestore = 9
$script:MouseLeftDown = 0x0002
$script:MouseLeftUp = 0x0004
$script:ProfileDirectory = $null

function Get-ChromeProfileDirectory {
  $localStatePath = Join-Path $env:LOCALAPPDATA (
    "Google\Chrome\User Data\Local State"
  )
  if (-not (Test-Path -LiteralPath $localStatePath)) {
    throw "Chrome Local State was not found."
  }
  $localState = Get-Content -LiteralPath $localStatePath -Raw |
    ConvertFrom-Json
  $matches = @(
    $localState.profile.info_cache.PSObject.Properties |
      Where-Object { $_.Value.name -eq $ExpectedProfileName }
  )
  if ($matches.Count -ne 1) {
    throw "Chrome profile $ExpectedProfileName could not be mapped to one profile directory."
  }
  return $matches[0].Name
}

function Get-CartUrl {
  param([string]$Id)

  $urls = @{
    "retailer-target" = "https://www.target.com/cart"
    "retailer-best-buy" = "https://www.bestbuy.com/cart"
    "retailer-pokemon-center" = "https://www.pokemoncenter.com/cart"
    "retailer-walmart" = "https://www.walmart.com/cart"
    "retailer-gamestop" = "https://www.gamestop.com/cart"
    "retailer-costco" = "https://www.costco.com/CartView"
    "retailer-sams-club" = "https://www.samsclub.com/cart"
    "retailer-barnes-noble" = "https://www.barnesandnoble.com/checkout/cart.jsp"
    "retailer-tcgplayer" = "https://www.tcgplayer.com/cart"
  }

  if (-not $urls.ContainsKey($Id)) {
    throw "Retailer $Id does not have a cart automation adapter."
  }
  return $urls[$Id]
}

function Get-ProductKeyFromUrl {
  param(
    [string]$Id,
    [string]$UrlValue
  )

  $normalizedUrl = if ($UrlValue -match "^https://") {
    $UrlValue
  } else {
    "https://$UrlValue"
  }
  $uri = [Uri]$normalizedUrl
  if ($uri.Scheme -ne "https") {
    throw "Product URL must use HTTPS."
  }
  $rules = @{
    "retailer-target" = @{
      Domain = "target.com"
      Patterns = @("/-/(A-\d+)/?$")
    }
    "retailer-best-buy" = @{
      Domain = "bestbuy.com"
      Patterns = @("/(\d+)\.p/?$", "[?&]skuId=(\d+)")
    }
    "retailer-pokemon-center" = @{
      Domain = "pokemoncenter.com"
      Patterns = @("/product/([^/?#]+)")
    }
    "retailer-walmart" = @{
      Domain = "walmart.com"
      Patterns = @("/ip/(?:[^/]+/)?(\d+)")
    }
    "retailer-gamestop" = @{
      Domain = "gamestop.com"
      Patterns = @("/(\d+)\.html$", "/product/[^/]+/(\d+)")
    }
    "retailer-costco" = @{
      Domain = "costco.com"
      Patterns = @("\.product\.(\d+)\.html$")
    }
    "retailer-sams-club" = @{
      Domain = "samsclub.com"
      Patterns = @("/ip/[^/]+/(prod\d+)")
    }
    "retailer-barnes-noble" = @{
      Domain = "barnesandnoble.com"
      Patterns = @("/w/[^/]+/(\d+)")
    }
    "retailer-tcgplayer" = @{
      Domain = "tcgplayer.com"
      Patterns = @("/product/(\d+)")
    }
  }
  if (-not $rules.ContainsKey($Id)) {
    throw "Retailer $Id does not support cart automation."
  }
  $rule = $rules[$Id]
  if (
    $uri.Host -ne $rule.Domain -and
    -not $uri.Host.EndsWith(".$($rule.Domain)")
  ) {
    throw "Product URL does not match retailer $Id."
  }
  foreach ($pattern in $rule.Patterns) {
    $match = [regex]::Match($uri.PathAndQuery, $pattern)
    if ($match.Success) {
      return $match.Groups[1].Value
    }
  }
  throw "Product URL does not contain a supported product ID."
}

function Test-ExactKeyToken {
  param([string]$Value)

  $token = $ProductKey -replace "^[A-Za-z]+-", ""
  return $Value -match (
    "(?i)(?<![A-Za-z0-9])" +
    [regex]::Escape($token) +
    "(?![A-Za-z0-9])"
  )
}

function Get-ChromeWindowHandles {
  $chromeProcesses = @(Get-Process chrome -ErrorAction SilentlyContinue)
  $processIds = [System.Collections.Generic.HashSet[uint]]::new()
  foreach ($process in $chromeProcesses) {
    [void]$processIds.Add([uint]$process.Id)
  }

  $handles = [System.Collections.Generic.List[long]]::new()
  [DealHunterWindows]::EnumWindows(
    {
      param([IntPtr]$windowHandle, [IntPtr]$state)

      if ([DealHunterWindows]::IsWindowVisible($windowHandle)) {
        [uint]$processId = 0
        [void][DealHunterWindows]::GetWindowThreadProcessId(
          $windowHandle,
          [ref]$processId
        )
        if ($processIds.Contains($processId)) {
          [void]$handles.Add($windowHandle.ToInt64())
        }
      }
      return $true
    },
    [IntPtr]::Zero
  ) | Out-Null
  return $handles
}

function Get-Pattern {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [System.Windows.Automation.AutomationPattern]$Pattern
  )

  $value = $null
  if ($Element.TryGetCurrentPattern($Pattern, [ref]$value)) {
    return $value
  }
  return $null
}

function Get-ElementValue {
  param([System.Windows.Automation.AutomationElement]$Element)

  $valuePattern = Get-Pattern $Element (
    [System.Windows.Automation.ValuePattern]::Pattern
  )
  if ($valuePattern) {
    return [string]$valuePattern.Current.Value
  }
  return ""
}

function Get-AddressBar {
  param([System.Windows.Automation.AutomationElement]$Window)

  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
    "view_1012"
  )
  return $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    $condition
  )
}

function Get-WindowAddress {
  param([System.Windows.Automation.AutomationElement]$Window)

  $addressBar = Get-AddressBar $Window
  if (-not $addressBar) {
    return ""
  }
  return Get-ElementValue $addressBar
}

function Wait-Until {
  param(
    [scriptblock]$Condition,
    [string]$FailureMessage
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  do {
    try {
      $value = & $Condition
      if ($null -ne $value -and $false -ne $value) {
        return $value
      }
    } catch [System.Windows.Automation.ElementNotAvailableException] {
    }
    Start-Sleep -Milliseconds 250
  } while ([DateTime]::UtcNow -lt $deadline)

  throw $FailureMessage
}

function Open-DedicatedChromeWindow {
  param([string]$Url)

  if (-not (Test-Path -LiteralPath $script:ChromePath)) {
    throw "Google Chrome is not installed at the expected location."
  }

  $before = [System.Collections.Generic.HashSet[long]]::new()
  foreach ($handle in Get-ChromeWindowHandles) {
    [void]$before.Add($handle)
  }
  $previousWindow = [DealHunterWindows]::GetForegroundWindow()

  $startInfo = [System.Diagnostics.ProcessStartInfo]::new(
    $script:ChromePath
  )
  $startInfo.UseShellExecute = $false
  $startInfo.CreateNoWindow = $true
  [void]$startInfo.ArgumentList.Add(
    "--profile-directory=$script:ProfileDirectory"
  )
  [void]$startInfo.ArgumentList.Add("--new-window")
  [void]$startInfo.ArgumentList.Add($Url)
  [System.Diagnostics.Process]::Start($startInfo) | Out-Null
  $expectedHost = ([Uri]$Url).Host -replace "^www\.", ""

  return Wait-Until {
    foreach ($handle in Get-ChromeWindowHandles) {
      if ($before.Contains($handle)) {
        continue
      }
      $window = [System.Windows.Automation.AutomationElement]::FromHandle(
        [IntPtr]$handle
      )
      if (-not $window) {
        continue
      }
      $address = Get-WindowAddress $window
      if (
        $address -and
        $address -match [regex]::Escape($expectedHost)
      ) {
        [void][DealHunterWindows]::ShowWindowAsync(
          [IntPtr]$handle,
          $script:SwRestore
        )
        [void][DealHunterWindows]::SetForegroundWindow([IntPtr]$handle)
        Start-Sleep -Milliseconds 500
        return [pscustomobject]@{
          Handle = [IntPtr]$handle
          Element = $window
          PreviousForeground = $previousWindow
        }
      }
    }
    return $null
  } "The dedicated Chrome automation window did not open."
}

function Close-DedicatedChromeWindow {
  param($Window)

  if ($Window -and $Window.Handle) {
    [void][DealHunterWindows]::PostMessage(
      $Window.Handle,
      $script:WmClose,
      [IntPtr]::Zero,
      [IntPtr]::Zero
    )
    if ($Window.PreviousForeground -ne [IntPtr]::Zero) {
      [void][DealHunterWindows]::SetForegroundWindow(
        $Window.PreviousForeground
      )
    }
  }
}

function Assert-ExpectedProfile {
  param([System.Windows.Automation.AutomationElement]$Window)

  $condition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    ),
    [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
      "view_1018"
    )
  )
  $profileButton = $Window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    $condition
  )
  if (-not $profileButton -or $profileButton.Current.Name -ne $ExpectedProfileName) {
    throw "The dedicated Chrome window is not using profile $ExpectedProfileName."
  }
}

function Get-DescendantsByControlType {
  param(
    [System.Windows.Automation.AutomationElement]$Root,
    [System.Windows.Automation.ControlType]$ControlType
  )

  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    $ControlType
  )
  return $Root.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    $condition
  )
}

function Get-RuntimeKey {
  param([System.Windows.Automation.AutomationElement]$Element)

  return ($Element.GetRuntimeId() -join ".")
}

function Convert-Quantity {
  param([System.Windows.Automation.AutomationElement]$QuantityControl)

  $value = Get-ElementValue $QuantityControl
  if (-not $value) {
    $value = $QuantityControl.Current.Name
  }
  $match = [regex]::Match($value, "\d+")
  if (-not $match.Success) {
    throw "A cart line quantity could not be read."
  }
  return [int]$match.Value
}

function Read-CartSnapshot {
  param([System.Windows.Automation.AutomationElement]$Window)

  $lines = @{}
  $quantityControls = @(
    Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::ComboBox
    )
    Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::Spinner
    )
  )
  $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

  foreach ($quantityControl in $quantityControls) {
    $candidate = $quantityControl
    for ($depth = 0; $depth -lt 8 -and $candidate; $depth += 1) {
      $links = Get-DescendantsByControlType $candidate (
        [System.Windows.Automation.ControlType]::Hyperlink
      )
      $productLink = $null
      foreach ($link in $links) {
        $href = Get-ElementValue $link
        if (
          $href -match "^https://" -and
          $href -notmatch "/cart|CartView|checkout/cart"
        ) {
          $productLink = $link
          break
        }
      }
      if ($productLink) {
        $runtimeKey = Get-RuntimeKey $candidate
        if (-not $lines.ContainsKey($runtimeKey)) {
                $href = Get-ElementValue $productLink
                try {
                  $lineProductKey = Get-ProductKeyFromUrl $RetailerId $href
                } catch {
                  break
                }
                $lines[$runtimeKey] = [pscustomobject]@{
                  Href = $href
                  ProductKey = $lineProductKey
                  Quantity = Convert-Quantity $quantityControl
                }
        }
        break
      }
      $candidate = $walker.GetParent($candidate)
    }
  }

  $totalUnits = 0
  $productQuantity = 0
  foreach ($line in $lines.Values) {
    $totalUnits += $line.Quantity
    if ($line.ProductKey -eq $ProductKey) {
      $productQuantity += $line.Quantity
    }
  }

  return [pscustomobject]@{
    ProductQuantity = $productQuantity
    TotalUnits = $totalUnits
  }
}

function Wait-ForCartSnapshot {
  param([System.Windows.Automation.AutomationElement]$Window)

  $stability = @{
    Previous = $null
    Samples = 0
  }
  return Wait-Until {
    $address = Get-WindowAddress $Window
    if ($address -notmatch "/cart|CartView|checkout/cart") {
      return $null
    }
    $texts = Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::Text
    )
    $cartReady = $false
    foreach ($text in $texts) {
      if ($text.Current.Name -match "(?i)^(cart|shopping cart|your cart)$") {
        $cartReady = $true
        break
      }
    }
    if (-not $cartReady) {
      return $null
    }

    $snapshot = Read-CartSnapshot $Window
    $headerCount = $null
    $cartLinks = Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::Hyperlink
    )
    foreach ($cartLink in $cartLinks) {
      $match = [regex]::Match(
        $cartLink.Current.Name,
        "(?i)^cart\s+(\d+)\s+items?$"
      )
      if ($match.Success) {
        $headerCount = [int]$match.Groups[1].Value
        break
      }
    }
    if ($null -ne $headerCount -and $snapshot.TotalUnits -ne $headerCount) {
      $stability.Previous = $null
      $stability.Samples = 0
      return $null
    }
    $currentKey = "$($snapshot.ProductQuantity):$($snapshot.TotalUnits)"
    if ($currentKey -eq $stability.Previous) {
      $stability.Samples += 1
    } else {
      $stability.Previous = $currentKey
      $stability.Samples = 1
    }
    if ($stability.Samples -ge 3) {
      return $snapshot
    }
    return $null
  } "The retailer cart did not become readable."
}

function Find-PrimaryAddButton {
  param([System.Windows.Automation.AutomationElement]$Window)

  $controls = @(
    Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::Button
    )
    Get-DescendantsByControlType $Window (
      [System.Windows.Automation.ControlType]::Hyperlink
    )
  )
  $matches = @()
  foreach ($control in $controls) {
    $name = $control.Current.Name
    if (
      $control.Current.IsEnabled -and
      $name -match "(?i)\b(add to cart|add to bag|pre-?order)\b"
    ) {
      $automationId = $control.Current.AutomationId
      if (
        (Test-ExactKeyToken $automationId) -or
        (Test-ExactKeyToken $name)
      ) {
        return $control
      }
      $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
      $container = $control
      for ($depth = 0; $depth -lt 8 -and $container; $depth += 1) {
        $links = Get-DescendantsByControlType $container (
          [System.Windows.Automation.ControlType]::Hyperlink
        )
        foreach ($link in $links) {
          try {
            if (
              (Get-ProductKeyFromUrl $RetailerId (
                Get-ElementValue $link
              )) -eq $ProductKey
            ) {
              return $control
            }
          } catch {
          }
        }
        $container = $walker.GetParent($container)
      }
      $matches += $control.Current.Name
    }
  }

  if ($matches.Count -eq 0) {
    throw "No enabled primary Add to cart or Preorder control was found."
  }
  throw "Purchase controls were visible, but none were bound to the exact product."
}

function Click-Element {
  param(
    [System.Windows.Automation.AutomationElement]$Element,
    [IntPtr]$WindowHandle
  )

  if (
    -not $Element.Current.IsEnabled -or
    $Element.Current.BoundingRectangle.IsEmpty
  ) {
    throw "The selected browser control is not clickable."
  }

  $previousWindow = [DealHunterWindows]::GetForegroundWindow()
  $cursor = [DealHunterWindows+POINT]::new()
  [void][DealHunterWindows]::GetCursorPos([ref]$cursor)
  $point = $Element.GetClickablePoint()
  try {
    [void][DealHunterWindows]::ShowWindowAsync(
      $WindowHandle,
      $script:SwRestore
    )
    [void][DealHunterWindows]::SetForegroundWindow($WindowHandle)
    Start-Sleep -Milliseconds 150
    [void][DealHunterWindows]::SetCursorPos(
      [int][Math]::Round($point.X),
      [int][Math]::Round($point.Y)
    )
    [DealHunterWindows]::mouse_event(
      $script:MouseLeftDown,
      0,
      0,
      0,
      [UIntPtr]::Zero
    )
    [DealHunterWindows]::mouse_event(
      $script:MouseLeftUp,
      0,
      0,
      0,
      [UIntPtr]::Zero
    )
  } finally {
    [void][DealHunterWindows]::SetCursorPos($cursor.X, $cursor.Y)
    if ($previousWindow -ne [IntPtr]::Zero) {
      [void][DealHunterWindows]::SetForegroundWindow($previousWindow)
    }
  }
}

function Add-ProductAndOpenCart {
  param($Window)

  Wait-Until {
    $address = Get-WindowAddress $Window.Element
    try {
      if (
        (Get-ProductKeyFromUrl $RetailerId $address) -eq $ProductKey
      ) {
        return $true
      }
    } catch {
    }
    return $false
  } "Chrome did not load the exact requested product."

  $button = Wait-Until {
    try {
      return Find-PrimaryAddButton $Window.Element
    } catch {
      return $null
    }
  } "The product did not expose an unambiguous cart control."
  Click-Element $button $Window.Handle

  $cartLink = Wait-Until {
    $links = Get-DescendantsByControlType $Window.Element (
      [System.Windows.Automation.ControlType]::Hyperlink
    )
    foreach ($link in $links) {
      if (
        $link.Current.Name -match "(?i)(view cart|go to cart|shopping cart|cart \d+ items?)" -and
        (Get-ElementValue $link) -match "/cart|CartView|checkout/cart"
      ) {
        return $link
      }
    }
    return $null
  } "The retailer did not confirm that the product was added."
  Click-Element $cartLink $Window.Handle
}

try {
  if (
    (Get-ProductKeyFromUrl $RetailerId $ProductUrl) -ne $ProductKey
  ) {
    throw "ProductUrl and ProductKey do not identify the same HTTPS product."
  }
  if (-not $ExpectedProfileName.Trim()) {
    throw "ExpectedProfileName is required."
  }
  $script:ProfileDirectory = Get-ChromeProfileDirectory

  $cartUrl = Get-CartUrl $RetailerId
  $baselineWindow = $null
  try {
    $baselineWindow = Open-DedicatedChromeWindow $cartUrl
    $null = Assert-ExpectedProfile $baselineWindow.Element
    $baseline = Wait-ForCartSnapshot $baselineWindow.Element
  } finally {
    $null = Close-DedicatedChromeWindow $baselineWindow
  }

  $actionWindow = $null
  try {
    $actionWindow = Open-DedicatedChromeWindow $ProductUrl
    $null = Assert-ExpectedProfile $actionWindow.Element
    $null = Add-ProductAndOpenCart $actionWindow
    $final = Wait-ForCartSnapshot $actionWindow.Element
  } finally {
    $null = Close-DedicatedChromeWindow $actionWindow
  }

  if (
    $final.ProductQuantity -ne $baseline.ProductQuantity + 1 -or
    $final.TotalUnits -ne $baseline.TotalUnits + 1
  ) {
    throw "Cart reconciliation failed: product $($baseline.ProductQuantity) -> $($final.ProductQuantity), total units $($baseline.TotalUnits) -> $($final.TotalUnits); both must increase by one."
  }

  [pscustomobject]@{
    success = $true
    productKey = $ProductKey
    baselineProductQuantity = $baseline.ProductQuantity
    finalProductQuantity = $final.ProductQuantity
    baselineCartUnits = $baseline.TotalUnits
    finalCartUnits = $final.TotalUnits
  } | ConvertTo-Json -Compress
} catch {
  [Console]::Error.WriteLine($_.Exception.Message)
  exit 1
}
