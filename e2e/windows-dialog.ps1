# Answers the Windows Open or Save dialog the way a person would: types the full path into the
# "File name" box and presses Open/Save. Uses UI Automation, so it works on whatever dialog is showing.
param([Parameter(Mandatory = $true)][string]$Path, [int]$Seconds = 60)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$A = [System.Windows.Automation.AutomationElement]
$T = [System.Windows.Automation.TreeScope]
$C = [System.Windows.Automation.ControlType]
$cond = { param($p, $v) New-Object System.Windows.Automation.PropertyCondition($p, $v) }

$deadline = (Get-Date).AddSeconds($Seconds)
$dialog = $null
while (-not $dialog -and (Get-Date) -lt $deadline) {
  # The common file dialog is a "#32770" window owned by the app's window.
  $dialog = $A::RootElement.FindFirst($T::Descendants, (& $cond $A::ClassNameProperty '#32770'))
  if (-not $dialog) { Start-Sleep -Milliseconds 250 }
}
if (-not $dialog) { throw 'The system file dialog did not open.' }
Write-Host "Dialog: $($dialog.Current.Name)"
Start-Sleep -Milliseconds 700

# The "File name" box: an Edit control (inside a combo box in the Open dialog).
$edits = $dialog.FindAll($T::Descendants, (& $cond $A::ControlTypeProperty $C::Edit))
$box = $null
foreach ($e in $edits) { if ($e.Current.AutomationId -in @('1148', '1001')) { $box = $e; break } }
if (-not $box) { foreach ($e in $edits) { if ($e.Current.Name -like 'File name*') { $box = $e; break } } }
if (-not $box) { throw 'No File name box in the dialog.' }
$box.SetFocus()
$box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Path)
Start-Sleep -Milliseconds 300

# Press Open / Save (the dialog's default button has AutomationId 1).
$button = $dialog.FindFirst($T::Descendants, (New-Object System.Windows.Automation.AndCondition(
  (& $cond $A::ControlTypeProperty $C::Button), (& $cond $A::AutomationIdProperty '1'))))
if (-not $button) { throw 'No Open/Save button in the dialog.' }
$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Write-Host "Answered with $Path"
