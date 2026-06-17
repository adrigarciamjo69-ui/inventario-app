//go:build windows
// +build windows

package main

import (
	"encoding/json"
	"os/exec"
	"strings"
)

// runPS ejecuta un script PowerShell y devuelve stdout.
func runPS(script string) ([]byte, error) {
	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script)
	return cmd.Output()
}

func osVersion() string {
	out, err := runPS(`(Get-CimInstance Win32_OperatingSystem | Select-Object Caption,Version | ConvertTo-Json -Compress)`)
	if err != nil {
		return ""
	}
	var o struct {
		Caption string `json:"Caption"`
		Version string `json:"Version"`
	}
	if json.Unmarshal(out, &o) == nil {
		return strings.TrimSpace(o.Caption + " " + o.Version)
	}
	return ""
}

func collect() (map[string]interface{}, []map[string]interface{}) {
	info := map[string]interface{}{}

	// CPU + RAM + BIOS + Sistema (un solo PowerShell para minimizar overhead)
	script := `
$ErrorActionPreference = 'SilentlyContinue'
$os  = Get-CimInstance Win32_OperatingSystem
$cs  = Get-CimInstance Win32_ComputerSystem
$bios= Get-CimInstance Win32_BIOS
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$disks = Get-CimInstance Win32_DiskDrive | Select-Object Model,Size,SerialNumber
$net = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True' | Select-Object Description,MACAddress,IPAddress
$out = @{
  os        = @{ caption=$os.Caption; version=$os.Version; build=$os.BuildNumber; install_date=$os.InstallDate.ToString('o'); last_boot=$os.LastBootUpTime.ToString('o') }
  system    = @{ manufacturer=$cs.Manufacturer; model=$cs.Model; domain=$cs.Domain; total_ram_bytes=$cs.TotalPhysicalMemory; user=$cs.UserName }
  bios      = @{ vendor=$bios.Manufacturer; version=$bios.SMBIOSBIOSVersion; serial=$bios.SerialNumber }
  cpu       = @{ name=$cpu.Name; cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; max_clock_mhz=$cpu.MaxClockSpeed; arch=$cpu.AddressWidth }
  disks     = @($disks)
  network   = @($net)
}
$out | ConvertTo-Json -Depth 5 -Compress
`
	if out, err := runPS(script); err == nil {
		var parsed map[string]interface{}
		if json.Unmarshal(out, &parsed) == nil {
			for k, v := range parsed {
				info[k] = v
			}
		}
	}

	// Antivirus registrados en SecurityCenter2.
	avScript := `
$ErrorActionPreference = 'SilentlyContinue'
$av = Get-CimInstance -Namespace 'root/SecurityCenter2' -ClassName AntiVirusProduct
$av | ForEach-Object {
  [pscustomobject]@{
    name              = $_.displayName
    state_hex         = ('{0:X6}' -f $_.productState)
    exe               = $_.pathToSignedProductExe
    reporting_exe     = $_.pathToSignedReportingExe
  }
} | ConvertTo-Json -Compress
`
	if out, err := runPS(avScript); err == nil && len(out) > 0 {
		trim := strings.TrimSpace(string(out))
		if strings.HasPrefix(trim, "{") {
			trim = "[" + trim + "]"
		}
		var arr []map[string]interface{}
		if json.Unmarshal([]byte(trim), &arr) == nil {
			info["antivirus"] = arr
		}
	}

	// BitLocker (volumenes de sistema cifrados o no).
	blScript := `
$ErrorActionPreference = 'SilentlyContinue'
Get-BitLockerVolume | ForEach-Object {
  [pscustomobject]@{
    mount             = $_.MountPoint
    protection_status = $_.ProtectionStatus.ToString()
    volume_status     = $_.VolumeStatus.ToString()
    encryption_pct    = $_.EncryptionPercentage
    encryption_method = $_.EncryptionMethod.ToString()
  }
} | ConvertTo-Json -Compress
`
	if out, err := runPS(blScript); err == nil && len(out) > 0 {
		trim := strings.TrimSpace(string(out))
		if strings.HasPrefix(trim, "{") {
			trim = "[" + trim + "]"
		}
		var arr []map[string]interface{}
		if json.Unmarshal([]byte(trim), &arr) == nil {
			info["bitlocker"] = arr
		}
	}

	// HotFixes / parches instalados (ultimos 50 ordenados por fecha).
	hfScript := `
$ErrorActionPreference = 'SilentlyContinue'
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object -First 50 HotFixID,Description,InstalledOn,InstalledBy | ConvertTo-Json -Compress
`
	if out, err := runPS(hfScript); err == nil && len(out) > 0 {
		trim := strings.TrimSpace(string(out))
		if strings.HasPrefix(trim, "{") {
			trim = "[" + trim + "]"
		}
		var arr []map[string]interface{}
		if json.Unmarshal([]byte(trim), &arr) == nil {
			info["hotfixes"] = arr
		}
	}

	// Usuarios logueados (sesiones activas).
	usrScript := "$ErrorActionPreference='SilentlyContinue'; $s = quser 2>$null; if ($s) { $lines = $s -split \"`n\" | Where-Object { $_ -match '\\S' }; $rows = $lines | Select-Object -Skip 1 | ForEach-Object { $cols = ($_ -replace '^>','') -split '\\s{2,}'; [pscustomobject]@{ username=$cols[0]; session=$cols[1]; state=$cols[3]; logon_time=$cols[5] } }; $rows | ConvertTo-Json -Compress } else { $cs = Get-CimInstance Win32_ComputerSystem; if ($cs.UserName) { @([pscustomobject]@{ username=$cs.UserName; session='console'; state='active' }) | ConvertTo-Json -Compress } }"
	if out, err := runPS(usrScript); err == nil && len(out) > 0 {
		trim := strings.TrimSpace(string(out))
		if strings.HasPrefix(trim, "{") {
			trim = "[" + trim + "]"
		}
		var arr []map[string]interface{}
		if json.Unmarshal([]byte(trim), &arr) == nil {
			info["logged_in_users"] = arr
		}
	}

	// Software desde el registro Uninstall (ambas vistas 32/64).
	softScript := `
$ErrorActionPreference = 'SilentlyContinue'
$paths = @(
  'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\SOFTWARE\Wow6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$rows = foreach($p in $paths){
  Get-ItemProperty $p | Where-Object { $_.DisplayName -and -not $_.SystemComponent } | ForEach-Object {
    [pscustomobject]@{
      name         = $_.DisplayName
      version      = $_.DisplayVersion
      publisher    = $_.Publisher
      install_date = $_.InstallDate
      arch         = if($_.PSPath -like '*Wow6432Node*'){'32-bit'}else{'64-bit'}
    }
  }
}
$rows | ConvertTo-Json -Compress
`
	soft := []map[string]interface{}{}
	if out, err := runPS(softScript); err == nil && len(out) > 0 {
		// puede devolver objeto unico o array.
		trim := strings.TrimSpace(string(out))
		if strings.HasPrefix(trim, "{") {
			trim = "[" + trim + "]"
		}
		var arr []map[string]interface{}
		if json.Unmarshal([]byte(trim), &arr) == nil {
			soft = arr
		}
	}
	return info, soft
}
