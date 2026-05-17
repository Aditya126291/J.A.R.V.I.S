Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$chromeCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1")
$chromes = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $chromeCondition)

foreach ($chrome in $chromes) {
    $tabCondition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::TabItem)
    $tabs = $chrome.FindAll([System.Windows.Automation.TreeScope]::Descendants, $tabCondition)
    foreach ($tab in $tabs) {
        if ($tab.Current.Name -match 'YouTube') {
            Write-Output "Found YouTube Tab: $($tab.Current.Name)"
            $closeCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Close")
            $closeBtns = $tab.FindAll([System.Windows.Automation.TreeScope]::Descendants, $closeCond)
            foreach ($btn in $closeBtns) {
                Write-Output "  Found Close Button in YouTube Tab: $($btn.Current.ControlType.ProgrammaticName)"
            }
        }
    }
}
