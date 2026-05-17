Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$chromeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
$chromes = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $chromeCondition)

$found = $false

foreach ($chrome in $chromes) {
    # Find all Tab items
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    
    foreach ($tab in $tabs) {
        if ($tab.Current.Name -match 'YouTube') {
            # Find the Close button inside the tab
            $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
            $closeBtn = $tab.FindFirst([System.Windows.Automation.TreeScope]::Children, $closeCond)
            
            if ($closeBtn) {
                $invokePattern = $closeBtn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invokePattern) {
                    $invokePattern.Invoke()
                    $found = $true
                    Write-Output "SUCCESS"
                    break
                }
            }
        }
    }
    if ($found) { break }
}

if (-not $found) {
    Write-Output "NOT_FOUND"
}
