Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$chromeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
$chromes = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $chromeCondition)

$keyword = 'YouTube'
$found = $false

# 1. Search for TabItems first
foreach ($chrome in $chromes) {
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    foreach ($tab in $tabs) {
        if ($tab.Current.Name -match $keyword) {
            $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
            $closeBtn = $tab.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeCond)
            if ($closeBtn) {
                $invokePattern = $closeBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invokePattern) {
                    $invokePattern.Invoke()
                    $found = $true
                    Write-Output "SUCCESS (TabItem)"
                    break
                }
            }
        }
    }
    if ($found) { break }
}

# 2. If no TabItem found, search for whole Chrome Window
if (-not $found) {
    foreach ($chrome in $chromes) {
        if ($chrome.Current.Name -match $keyword) {
            $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
            $closeBtn = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeCond)
            if ($closeBtn) {
                $invokePattern = $closeBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invokePattern) {
                    $invokePattern.Invoke()
                    $found = $true
                    Write-Output "SUCCESS (Window)"
                    break
                }
            }
        }
    }
}

if (-not $found) {
    Write-Output "NOT_FOUND"
}
