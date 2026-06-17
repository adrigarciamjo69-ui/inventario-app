//go:build linux
// +build linux

package main

import (
	"bufio"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

func osVersion() string {
	f, err := os.Open("/etc/os-release")
	if err != nil {
		return ""
	}
	defer f.Close()
	vars := map[string]string{}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if i := strings.IndexByte(line, '='); i > 0 {
			k := strings.TrimSpace(line[:i])
			v := strings.Trim(strings.TrimSpace(line[i+1:]), "\"")
			vars[k] = v
		}
	}
	if v := vars["PRETTY_NAME"]; v != "" {
		return v
	}
	return strings.TrimSpace(vars["NAME"] + " " + vars["VERSION"])
}

func readFirst(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func collect() (map[string]interface{}, []map[string]interface{}) {
	info := map[string]interface{}{}

	// OS
	info["os"] = map[string]string{
		"caption": osVersion(),
		"kernel":  strings.TrimSpace(string(execOrEmpty("uname", "-r"))),
		"arch":    runtime.GOARCH,
	}

	// BIOS / Manufacturer (sysfs DMI)
	info["bios"] = map[string]string{
		"vendor":  readFirst("/sys/class/dmi/id/bios_vendor"),
		"version": readFirst("/sys/class/dmi/id/bios_version"),
		"serial":  readFirst("/sys/class/dmi/id/product_serial"),
	}
	info["system"] = map[string]string{
		"manufacturer": readFirst("/sys/class/dmi/id/sys_vendor"),
		"model":        readFirst("/sys/class/dmi/id/product_name"),
	}

	// CPU
	cpuInfo := map[string]interface{}{}
	if f, err := os.Open("/proc/cpuinfo"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "model name") {
				if i := strings.Index(line, ":"); i > 0 {
					cpuInfo["name"] = strings.TrimSpace(line[i+1:])
					break
				}
			}
		}
		f.Close()
	}
	cpuInfo["threads"] = runtime.NumCPU()
	info["cpu"] = cpuInfo

	// RAM
	if f, err := os.Open("/proc/meminfo"); err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			if strings.HasPrefix(line, "MemTotal:") {
				parts := strings.Fields(line)
				if len(parts) >= 2 {
					if kb, err := strconv.ParseInt(parts[1], 10, 64); err == nil {
						info["ram"] = map[string]interface{}{"total_bytes": kb * 1024}
					}
				}
				break
			}
		}
		f.Close()
	}

	// Network - lectura simple, IPs por /proc/net/fib_trie es complejo; usar 'ip -j addr' si esta
	if out, err := exec.Command("ip", "-j", "addr").Output(); err == nil && len(out) > 0 {
		info["network_raw"] = string(out)
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

	// Antivirus / endpoint protection (best-effort: detectamos por procesos o servicios).
	av := []map[string]interface{}{}
	knownAV := []struct{ name, hint string }{
		{"ClamAV", "clamd"},
		{"Sophos", "sophos"},
		{"Bitdefender", "bdsec"},
		{"CrowdStrike Falcon", "falcon-sensor"},
		{"SentinelOne", "sentinelone"},
		{"ESET", "esets"},
		{"Kaspersky", "kesl"},
	}
	psOut, _ := exec.Command("ps", "-eo", "comm").Output()
	psStr := strings.ToLower(string(psOut))
	for _, a := range knownAV {
		if strings.Contains(psStr, a.hint) {
			av = append(av, map[string]interface{}{"name": a.name, "running": true})
		}
	}
	if len(av) > 0 {
		info["antivirus"] = av
	}

	// Cifrado de disco (LUKS): lsblk -o NAME,TYPE,FSTYPE
	if out, err := exec.Command("lsblk", "-J", "-o", "NAME,TYPE,FSTYPE,MOUNTPOINT").Output(); err == nil {
		encrypted := []map[string]interface{}{}
		if strings.Contains(string(out), "crypto_LUKS") {
			encrypted = append(encrypted, map[string]interface{}{"type": "LUKS", "detected": true})
		}
		if len(encrypted) > 0 {
			info["disk_encryption"] = encrypted
		}
	}

	// Actualizaciones pendientes (best-effort por gestor).
	switch {
	case hasCmd("apt"):
		if out, err := exec.Command("apt", "list", "--upgradable").Output(); err == nil {
			n := strings.Count(string(out), "\n") - 1
			if n < 0 {
				n = 0
			}
			info["updates_pending"] = map[string]interface{}{"manager": "apt", "count": n}
		}
	case hasCmd("dnf"):
		if out, err := exec.Command("dnf", "check-update", "-q").Output(); err == nil {
			lines := strings.Split(strings.TrimSpace(string(out)), "\n")
			info["updates_pending"] = map[string]interface{}{"manager": "dnf", "count": len(lines)}
		}
	}

	// Software instalado
	soft := []map[string]interface{}{}
	switch {
	case hasCmd("dpkg-query"):
		// Debian / Ubuntu
		out, err := exec.Command("dpkg-query", "-W", "-f=${Package}\t${Version}\t${Maintainer}\t${Architecture}\n").Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
				cols := strings.Split(line, "\t")
				if len(cols) >= 1 && cols[0] != "" {
					item := map[string]interface{}{"name": cols[0]}
					if len(cols) >= 2 {
						item["version"] = cols[1]
					}
					if len(cols) >= 3 {
						item["publisher"] = cols[2]
					}
					if len(cols) >= 4 {
						item["arch"] = cols[3]
					}
					soft = append(soft, item)
				}
			}
		}
	case hasCmd("rpm"):
		out, err := exec.Command("rpm", "-qa", "--qf", "%{NAME}\t%{VERSION}-%{RELEASE}\t%{VENDOR}\t%{ARCH}\n").Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
				cols := strings.Split(line, "\t")
				if len(cols) >= 1 && cols[0] != "" {
					item := map[string]interface{}{"name": cols[0]}
					if len(cols) >= 2 {
						item["version"] = cols[1]
					}
					if len(cols) >= 3 {
						item["publisher"] = cols[2]
					}
					if len(cols) >= 4 {
						item["arch"] = cols[3]
					}
					soft = append(soft, item)
				}
			}
		}
	case hasCmd("pacman"):
		out, err := exec.Command("pacman", "-Q").Output()
		if err == nil {
			for _, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
				parts := strings.SplitN(line, " ", 2)
				if len(parts) >= 1 && parts[0] != "" {
					item := map[string]interface{}{"name": parts[0]}
					if len(parts) >= 2 {
						item["version"] = parts[1]
					}
					soft = append(soft, item)
				}
			}
		}
	}

	// Flatpak / snap como complemento
	if hasCmd("flatpak") {
		if out, err := exec.Command("flatpak", "list", "--app", "--columns=name,version,origin").Output(); err == nil {
			for i, line := range strings.Split(strings.TrimRight(string(out), "\n"), "\n") {
				if i == 0 || line == "" {
					continue
				}
				cols := strings.Split(line, "\t")
				item := map[string]interface{}{"name": cols[0], "arch": "flatpak"}
				if len(cols) >= 2 {
					item["version"] = cols[1]
				}
				if len(cols) >= 3 {
					item["publisher"] = cols[2]
				}
				soft = append(soft, item)
			}
		}
	}
	return info, soft
}

func execOrEmpty(name string, args ...string) []byte {
	out, err := exec.Command(name, args...).Output()
	if err != nil {
		return nil
	}
	return out
}

func hasCmd(name string) bool {
	_, err := exec.LookPath(name)
	return err == nil
}
