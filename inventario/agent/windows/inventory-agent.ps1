<#
InventarioIT - Agente Windows
Recoge inventario local y lo envia al backend central.

Configuracion por variables de entorno o parametros:
  INVENTARIO_API_URL   Ej: https://inventario.midominio.com/api
  INVENTARIO_AGENT_TOKEN
  INVENTARIO_DELEGATION

Instalacion programada recomendada:
  powershell.exe -ExecutionPolicy Bypass -File .\install-scheduled-task.ps1 -ApiUrl "https://.../api" -Token "invagt_..." -Delegation "Delegacion Norte"
#>
param(
  [string]$ApiUrl = $env:INVENTARIO_API_URL,
  [string]$Token = $env:INVENTARIO_AGENT_TOKEN,
  [string]$Delegation = $env:INVENTARIO_DELEGATION
)

$ErrorActionPreference = 'SilentlyContinue'
$AgentVersion = '1.0.0'

function First-MacAddress {
  $nic = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true -and $_.MACAddress } | Select-Object -First 1
  if ($nic) { return $nic.MACAddress }
  return $null
}

function First-IPv4Address {
  $nic = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true -and $_.IPAddress } | Select-Object -First 1
  if ($nic) { return ($nic.IPAddress | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1) }
  return $null
}

function Get-InstalledSoftware {
  $paths = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  )
  $items = foreach ($p in $paths) {
    Get-ItemProperty $p | Where-Object { $_.DisplayName } | ForEach-Object {
      [PSCustomObject]@{
        name = $_.DisplayName
        version = $_.DisplayVersion
        vendor = $_.Publisher
        install_date = $_.InstallDate
        arch = if ($p -like '*WOW6432Node*') { 'x86' } else { 'x64' }
      }
    }
  }
  $items | Sort-Object name, version -Unique
}

if (-not $ApiUrl -or -not $Token) {
  Write-Error 'Falta configuracion: ApiUrl/INVENTARIO_API_URL y Token/INVENTARIO_AGENT_TOKEN son obligatorios.'
  exit 2
}

$ApiUrl = $ApiUrl.TrimEnd('/')
$cs = Get-CimInstance Win32_ComputerSystem
$bios = Get-CimInstance Win32_BIOS
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor
$mem = Get-CimInstance Win32_PhysicalMemory
$disk = Get-CimInstance Win32_DiskDrive
$logical = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3"
$net = Get-CimInstance Win32_NetworkAdapterConfiguration | Where-Object { $_.IPEnabled -eq $true }
$gpu = Get-CimInstance Win32_VideoController

$serial = ($bios.SerialNumber | ForEach-Object { $_.Trim() })
$hostname = $env:COMPUTERNAME

$payload = [ordered]@{
  agent_id = if ($serial) { $serial } else { $hostname }
  agent_version = $AgentVersion
  agent_platform = 'windows'
  delegation = $Delegation
  hostname = $hostname
  ip = First-IPv4Address
  mac = First-MacAddress
  os = $os.Caption
  serial_number = $serial
  brand = $cs.Manufacturer
  model = $cs.Model
  category = if ($os.ProductType -ne 1) { 'server' } else { if ($cs.PCSystemType -eq 2) { 'laptop' } else { 'desktop' } }
  enrich_method = 'agent-windows'
  system_info = [ordered]@{
    computer = [ordered]@{
      hostname = $hostname
      manufacturer = $cs.Manufacturer
      model = $cs.Model
      domain = $cs.Domain
      total_physical_memory = [int64]$cs.TotalPhysicalMemory
      logged_user = $cs.UserName
      pc_system_type = $cs.PCSystemType
    }
    bios = [ordered]@{
      serial_number = $serial
      manufacturer = $bios.Manufacturer
      version = $bios.SMBIOSBIOSVersion
      release_date = $bios.ReleaseDate
    }
    os = [ordered]@{
      caption = $os.Caption
      version = $os.Version
      build_number = $os.BuildNumber
      architecture = $os.OSArchitecture
      install_date = $os.InstallDate
      last_boot = $os.LastBootUpTime
    }
    cpu = @($cpu | ForEach-Object { [ordered]@{ name=$_.Name; cores=$_.NumberOfCores; logical_processors=$_.NumberOfLogicalProcessors; max_clock_mhz=$_.MaxClockSpeed } })
    memory = @($mem | ForEach-Object { [ordered]@{ manufacturer=$_.Manufacturer; capacity=[int64]$_.Capacity; speed=$_.Speed; part_number=$_.PartNumber; serial_number=$_.SerialNumber } })
    disks = @($disk | ForEach-Object { [ordered]@{ model=$_.Model; size=[int64]$_.Size; interface=$_.InterfaceType; serial_number=$_.SerialNumber } })
    logical_disks = @($logical | ForEach-Object { [ordered]@{ device_id=$_.DeviceID; filesystem=$_.FileSystem; size=[int64]$_.Size; free_space=[int64]$_.FreeSpace } })
    network = @($net | ForEach-Object { [ordered]@{ description=$_.Description; mac=$_.MACAddress; ip=$_.IPAddress; gateway=$_.DefaultIPGateway; dns=$_.DNSServerSearchOrder; dhcp=$_.DHCPEnabled } })
    video = @($gpu | ForEach-Object { [ordered]@{ name=$_.Name; driver_version=$_.DriverVersion; adapter_ram=$_.AdapterRAM } })
  }
  software = @(Get-InstalledSoftware)
}

$json = $payload | ConvertTo-Json -Depth 8 -Compress
try {
  $headers = @{ Authorization = "Bearer $Token"; 'Content-Type' = 'application/json' }
  $response = Invoke-RestMethod -Method Post -Uri "$ApiUrl/agents/report" -Headers $headers -Body $json -TimeoutSec 60
  Write-Output ($response | ConvertTo-Json -Depth 5)
  exit 0
} catch {
  Write-Error "Error enviando inventario: $($_.Exception.Message)"
  exit 1
}
