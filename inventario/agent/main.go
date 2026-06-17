// Inventario Agent - cliente endpoint multiplataforma (Windows/Linux/macOS).
//
// Subcomandos:
//   inventario-agent enroll --server URL --key KEY
//       Enrola el equipo: registra machine_id en el backend y guarda el token
//       permanente devuelto. Solo se ejecuta una vez por equipo.
//
//   inventario-agent run
//       Bucle principal: hace checkin cada N minutos enviando system_info y
//       software detectado. Pensado para correr como servicio (systemd /
//       Windows Service / launchd).
//
//   inventario-agent once
//       Hace un solo checkin y termina (util para cron / debug).
//
//   inventario-agent status
//       Muestra config + ultimo error.
//
// Stdlib only. No dependencias externas para que el binario quede portable.
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"runtime"
	"strings"
	"time"
)

const agentVersion = "0.1.0"

func main() {
	log.SetFlags(log.LstdFlags | log.LUTC)
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	cmd := os.Args[1]
	os.Args = append([]string{os.Args[0]}, os.Args[2:]...)

	switch cmd {
	case "enroll":
		cmdEnroll()
	case "run":
		cmdRun()
	case "once":
		cmdOnce()
	case "status":
		cmdStatus()
	case "version", "-v", "--version":
		fmt.Println("inventario-agent", agentVersion, runtime.GOOS+"/"+runtime.GOARCH)
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "uso:")
	fmt.Fprintln(os.Stderr, "  inventario-agent enroll --server URL --key KEY")
	fmt.Fprintln(os.Stderr, "  inventario-agent run")
	fmt.Fprintln(os.Stderr, "  inventario-agent once")
	fmt.Fprintln(os.Stderr, "  inventario-agent status")
	fmt.Fprintln(os.Stderr, "  inventario-agent version")
}

// ---- enroll -----------------------------------------------------------------

func cmdEnroll() {
	fs := flag.NewFlagSet("enroll", flag.ExitOnError)
	server := fs.String("server", "", "URL del backend (ej: https://inv.empresa.com)")
	key := fs.String("key", "", "enroll_key obtenida en Ajustes > Agentes")
	fs.Parse(os.Args[1:])

	if *server == "" || *key == "" {
		log.Fatal("--server y --key son obligatorios")
	}
	cfg, _ := loadConfig() // si ya existe se reutiliza machine_id
	if cfg.MachineID == "" {
		cfg.MachineID = newMachineID()
	}
	cfg.ServerURL = strings.TrimRight(*server, "/")

	hostname, _ := os.Hostname()
	osName, osVer := osInfo()

	body, _ := json.Marshal(map[string]string{
		"enroll_key":    *key,
		"machine_id":    cfg.MachineID,
		"hostname":      hostname,
		"os":            osName,
		"os_version":    osVer,
		"agent_version": agentVersion,
	})
	resp, err := httpPost(cfg.ServerURL+"/api/agent/enroll", body, "")
	if err != nil {
		log.Fatalf("enroll: %v", err)
	}
	var out struct {
		Token    string `json:"token"`
		DeviceID int    `json:"device_id"`
		Error    string `json:"error"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		log.Fatalf("enroll: respuesta invalida: %s", string(resp))
	}
	if out.Error != "" || out.Token == "" {
		log.Fatalf("enroll: %s", out.Error)
	}
	cfg.Token = out.Token
	cfg.DeviceID = out.DeviceID
	if err := saveConfig(cfg); err != nil {
		log.Fatalf("no se pudo guardar config: %v", err)
	}
	fmt.Printf("Enrolado correctamente. device_id=%d machine_id=%s\n", out.DeviceID, cfg.MachineID)
	fmt.Printf("Config guardada en %s\n", configPath())
}

// ---- run / once -------------------------------------------------------------

func cmdRun() {
	cfg, err := loadConfig()
	if err != nil || cfg.Token == "" {
		log.Fatalf("agente no enrolado: ejecuta 'inventario-agent enroll --server URL --key KEY' primero")
	}
	interval := 60 * time.Minute
	log.Printf("inventario-agent v%s arrancado. server=%s machine_id=%s", agentVersion, cfg.ServerURL, cfg.MachineID)
	for {
		next, err := doCheckin(cfg)
		if err != nil {
			log.Printf("checkin error: %v", err)
		} else if next > 0 {
			interval = time.Duration(next) * time.Second
		}
		log.Printf("siguiente checkin en %s", interval)
		time.Sleep(interval)
	}
}

func cmdOnce() {
	cfg, err := loadConfig()
	if err != nil || cfg.Token == "" {
		log.Fatalf("agente no enrolado")
	}
	if _, err := doCheckin(cfg); err != nil {
		log.Fatalf("checkin error: %v", err)
	}
	fmt.Println("Checkin OK")
}

func cmdStatus() {
	cfg, err := loadConfig()
	if err != nil {
		log.Fatalf("no config: %v", err)
	}
	fmt.Println("config path: ", configPath())
	fmt.Println("server_url:  ", cfg.ServerURL)
	fmt.Println("machine_id:  ", cfg.MachineID)
	fmt.Println("device_id:   ", cfg.DeviceID)
	fmt.Println("token set:   ", cfg.Token != "")
}

func doCheckin(cfg *Config) (nextSeconds int, err error) {
	hostname, _ := os.Hostname()
	osName, osVer := osInfo()
	info, soft := collect() // implementaciones por SO

	payload := map[string]interface{}{
		"hostname":      hostname,
		"os":            osName,
		"os_version":    osVer,
		"agent_version": agentVersion,
		"system_info":   info,
		"software":      soft,
	}
	body, _ := json.Marshal(payload)
	resp, err := httpPost(cfg.ServerURL+"/api/agent/checkin", body, cfg.Token)
	if err != nil {
		return 0, err
	}
	var out struct {
		Ok                 bool   `json:"ok"`
		Linked             bool   `json:"linked"`
		NextCheckinSeconds int    `json:"next_checkin_seconds"`
		Error              string `json:"error"`
	}
	if err := json.Unmarshal(resp, &out); err != nil {
		return 0, fmt.Errorf("respuesta invalida: %s", string(resp))
	}
	if out.Error != "" {
		return 0, fmt.Errorf("%s", out.Error)
	}
	log.Printf("checkin OK linked=%v software=%d", out.Linked, len(soft))
	return out.NextCheckinSeconds, nil
}

// ---- http -------------------------------------------------------------------

var httpClient = &http.Client{Timeout: 60 * time.Second}

func httpPost(url string, body []byte, agentToken string) ([]byte, error) {
	req, _ := http.NewRequest("POST", url, bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "inventario-agent/"+agentVersion+" ("+runtime.GOOS+")")
	if agentToken != "" {
		req.Header.Set("X-Agent-Token", agentToken)
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode >= 400 {
		return data, fmt.Errorf("HTTP %d: %s", resp.StatusCode, string(data))
	}
	return data, nil
}

// ---- helpers ----------------------------------------------------------------

func newMachineID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(b)
}

// osInfo devuelve (os, os_version). os es 'windows'|'linux'|'darwin'.
func osInfo() (string, string) {
	os := runtime.GOOS
	ver := osVersion() // implementacion por SO
	return os, ver
}
