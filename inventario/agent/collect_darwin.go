//go:build darwin
// +build darwin

package main

import (
	"encoding/json"
	"os/exec"
	"runtime"
	"strings"
)

func osVersion() string {
	out, err := exec.Command("sw_vers").Output()
	if err != nil {
		return ""
	}
	res := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		if i := strings.Index(line, ":"); i > 0 {
			res[strings.TrimSpace(line[:i])] = strings.TrimSpace(line[i+1:])
		}
	}
	return strings.TrimSpace(res["ProductName"] + " " + res["ProductVersion"] + " (" + res["BuildVersion"] + ")")
}

func collect() (map[string]interface{}, []map[string]interface{}) {
	info := map[string]interface{}{}

	info["os"] = map[string]string{
		"caption": osVersion(),
		"arch":    runtime.GOARCH,
	}

	// system_profiler hardware
	if out, err := exec.Command("system_profiler", "-json", "SPHardwareDataType").Output(); err == nil {
		var parsed struct {
			SPHardwareDataType []map[string]interface{} `json:"SPHardwareDataType"`
		}
		if json.Unmarshal(out, &parsed) == nil && len(parsed.SPHardwareDataType) > 0 {
			h := parsed.SPHardwareDataType[0]
			info["system"] = map[string]interface{}{
				"manufacturer": "Apple",
				"model":        h["machine_model"],
				"model_name":   h["machine_name"],
			}
			info["cpu"] = map[string]interface{}{
				"name":    h["chip_type"],
				"cores":   h["number_processors"],
				"threads": runtime.NumCPU(),
			}
			info["bios"] = map[string]interface{}{
				"serial":  h["serial_number"],
				"version": h["boot_rom_version"],
			}
			info["ram"] = map[string]interface{}{"total_human": h["physical_memory"]}
		}
	}

	// Network
	if out, err := exec.Command("ifconfig").Output(); err == nil {
		info["network_raw"] = string(out)
	}

	// FileVault (cifrado de disco macOS).
	if out, err := exec.Command("fdesetup", "status").Output(); err == nil {
		text := strings.TrimSpace(string(out))
		enabled := strings.Contains(strings.ToLower(text), "filevault is on")
		info["filevault"] = map[string]interface{}{
			"enabled": enabled,
			"status":  text,
		}
	}

	// Usuarios logueados via 'who'.
	if out, err := exec.Command("who").Output(); err == nil {
		users := []map[string]interface{}{}
		for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
			if line == "" {
				continue
			}
			cols := strings.Fields(line)
			if len(cols) >= 1 {
				u := map[string]interface{}{"username": cols[0]}
				if len(cols) >= 2 {
					u["session"] = cols[1]
				}
				if len(cols) >= 4 {
					u["logon_time"] = cols[2] + " " + cols[3]
				}
				users = append(users, u)
			}
		}
		info["logged_in_users"] = users
	}

	// XProtect / Gatekeeper como info de seguridad basica.
	if out, err := exec.Command("spctl", "--status").Output(); err == nil {
		info["gatekeeper"] = strings.TrimSpace(string(out))
	}

	// Actualizaciones pendientes via softwareupdate.
	if out, err := exec.Command("softwareupdate", "--list").CombinedOutput(); err == nil {
		text := string(out)
		if strings.Contains(text, "No new software available") {
			info["updates_pending"] = map[string]interface{}{"count": 0}
		} else {
			n := strings.Count(text, "* Label:")
			if n > 0 {
				info["updates_pending"] = map[string]interface{}{"count": n}
			}
		}
	}

	// Software: aplicaciones instaladas via system_profiler SPApplicationsDataType
	soft := []map[string]interface{}{}
	if out, err := exec.Command("system_profiler", "-json", "SPApplicationsDataType").Output(); err == nil {
		var parsed struct {
			SPApplicationsDataType []map[string]interface{} `json:"SPApplicationsDataType"`
		}
		if json.Unmarshal(out, &parsed) == nil {
			for _, app := range parsed.SPApplicationsDataType {
				name, _ := app["_name"].(string)
				if name == "" {
					continue
				}
				item := map[string]interface{}{"name": name}
				if v, ok := app["version"]; ok {
					item["version"] = v
				}
				if v, ok := app["info"]; ok {
					item["publisher"] = v
				}
				if v, ok := app["arch_kind"]; ok {
					item["arch"] = v
				}
				if v, ok := app["lastModified"]; ok {
					item["install_date"] = v
				}
				soft = append(soft, item)
			}
		}
	}
	return info, soft
}
