package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
)

type Config struct {
	ServerURL string `json:"server_url"`
	MachineID string `json:"machine_id"`
	Token     string `json:"token"`
	DeviceID  int    `json:"device_id"`
}

func configDir() string {
	switch runtime.GOOS {
	case "windows":
		pd := os.Getenv("ProgramData")
		if pd == "" {
			pd = `C:\ProgramData`
		}
		return filepath.Join(pd, "inventario-agent")
	case "darwin":
		return "/Library/Application Support/inventario-agent"
	default: // linux y otros
		return "/etc/inventario-agent"
	}
}

func configPath() string {
	return filepath.Join(configDir(), "config.json")
}

func loadConfig() (*Config, error) {
	c := &Config{}
	data, err := os.ReadFile(configPath())
	if err != nil {
		return c, err
	}
	if err := json.Unmarshal(data, c); err != nil {
		return c, err
	}
	return c, nil
}

func saveConfig(c *Config) error {
	if err := os.MkdirAll(configDir(), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return err
	}
	// Permisos restrictivos: contiene token permanente.
	return os.WriteFile(configPath(), data, 0o600)
}
