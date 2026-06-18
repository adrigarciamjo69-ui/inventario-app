param(
  [Parameter(Mandatory=$true)][string]$ApiUrl,
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$Delegation = '',
  [string]$InstallDir = 'C:\Program Files\InventarioIT\Agent',
  [string]$TaskName = 'InventarioIT Agent',
  [string]$At = '03:00'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Copy-Item -Path "$PSScriptRoot\inventory-agent.ps1" -Destination "$InstallDir\inventory-agent.ps1" -Force

[Environment]::SetEnvironmentVariable('INVENTARIO_API_URL', $ApiUrl, 'Machine')
[Environment]::SetEnvironmentVariable('INVENTARIO_AGENT_TOKEN', $Token, 'Machine')
[Environment]::SetEnvironmentVariable('INVENTARIO_DELEGATION', $Delegation, 'Machine')

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$InstallDir\inventory-agent.ps1`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

Write-Host "Agente instalado. Ejecutando primera sincronizacion..."
Start-ScheduledTask -TaskName $TaskName
Write-Host "OK. Tarea programada: $TaskName"
