Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$chromeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
$chromes = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $chromeCondition)

$found = $false

foreach ($chrome in $chromes) {
    if ($chrome.Current.Name -match 'YouTube') {
        # Find the close button
        $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
        # To avoid closing the whole browser if there are multiple tabs, let's just send the close invoke to the first Close button found.
        # But wait, if this is a separate Window, closing it closes the tab.
        $closeBtn = $chrome.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $closeCond)
        
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

if (-not $found) {
    Write-Output "NOT_FOUND"
}
