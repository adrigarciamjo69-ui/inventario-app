# Inventario Agent

Agente endpoint multiplataforma para Inventario IT. Recoge `system_info` y
software instalado y lo envia al backend **sin necesitar credenciales de
dominio** ni que el equipo tenga abiertos WinRM/SMB. Funciona en LAN y fuera
de ella (teletrabajo) porque la conexion es saliente HTTPS.

## Soporta

- Windows 10 / 11 / Server 2016+ (recoge datos via PowerShell + registro Uninstall)
- Linux con `dpkg`, `rpm` o `pacman` (Debian/Ubuntu, RHEL/Fedora, Arch)
- macOS 11+ (system_profiler)

## Compilar

### Opcion A (recomendada): con Docker, sin instalar Go

Solo necesitas Docker. El script monta el codigo en un contenedor `golang:1.22-alpine`
y cross-compila los 4 binarios.

```bash
cd agent
chmod +x build.sh
./build.sh
```

O desde PowerShell en Windows:

```powershell
cd agent
.\build.ps1
```

Los binarios quedan en `agent/bin/`:

```
bin/inventario-agent-windows.exe       (Windows amd64)
bin/inventario-agent-linux             (Linux amd64)
bin/inventario-agent-darwin            (alias de darwin-arm64)
bin/inventario-agent-darwin-amd64      (macOS Intel)
bin/inventario-agent-darwin-arm64      (macOS Apple Silicon)
```

Subelos a la app desde **Ajustes -> Agentes -> Binarios del agente**
(un upload por SO). A partir de ese momento los equipos los descargan
desde `/api/agent/download/<so>`.

### Opcion B: con Go instalado localmente

Go 1.21+. Sin dependencias externas (stdlib).

```bash
cd agent
GOOS=windows GOARCH=amd64 go build -o bin/inventario-agent-windows.exe .
GOOS=linux   GOARCH=amd64 go build -o bin/inventario-agent-linux .
GOOS=darwin  GOARCH=amd64 go build -o bin/inventario-agent-darwin-amd64 .
GOOS=darwin  GOARCH=arm64 go build -o bin/inventario-agent-darwin-arm64 .
```

El binario pesa ~6-8 MB.

## Uso

### 1. Obtener la enroll_key

En la app: **Ajustes -> Agentes endpoint** -> pestaña "Clave de enrolamiento".
Copia el valor.

### 2. Enrolar el equipo (una sola vez)

```bash
sudo ./inventario-agent enroll --server https://inventario.empresa.com --key <ENROLL_KEY>
```

Genera un `machine_id` aleatorio, lo registra en el backend y guarda el token
permanente devuelto en:

| SO       | Ruta                                                        |
| -------- | ----------------------------------------------------------- |
| Windows  | `%ProgramData%\inventario-agent\config.json`                |
| Linux    | `/etc/inventario-agent/config.json`                         |
| macOS    | `/Library/Application Support/inventario-agent/config.json` |

El fichero se guarda con permisos 0600 (contiene el token).

### 3. Arrancar el bucle de checkin

```bash
./inventario-agent run
```

Dispara un checkin nada mas arrancar y luego cada hora (el servidor puede
sobreescribir el intervalo via `next_checkin_seconds`).

Para debug puedes lanzar un solo checkin:

```bash
./inventario-agent once
```

## Instalacion como servicio

### Windows (PowerShell admin)

```powershell
New-Item -ItemType Directory -Force -Path "C:\ProgramData\inventario-agent"
Copy-Item .\inventario-agent-windows.exe "C:\ProgramData\inventario-agent\inventario-agent.exe"
& "C:\ProgramData\inventario-agent\inventario-agent.exe" enroll --server https://inv.empresa.com --key XXXX
New-Service -Name InventarioAgent `
  -BinaryPathName "C:\ProgramData\inventario-agent\inventario-agent.exe run" `
  -StartupType Automatic
Start-Service InventarioAgent
```

### Linux (systemd)

```bash
sudo cp inventario-agent-linux /usr/local/bin/inventario-agent
sudo chmod +x /usr/local/bin/inventario-agent
sudo /usr/local/bin/inventario-agent enroll --server https://inv.empresa.com --key XXXX

sudo tee /etc/systemd/system/inventario-agent.service >/dev/null <<EOF
[Unit]
Description=Inventario Agent
After=network-online.target

[Service]
ExecStart=/usr/local/bin/inventario-agent run
Restart=always
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now inventario-agent
```

### macOS (launchd)

```bash
sudo cp inventario-agent-darwin-arm64 /usr/local/bin/inventario-agent
sudo chmod +x /usr/local/bin/inventario-agent
sudo /usr/local/bin/inventario-agent enroll --server https://inv.empresa.com --key XXXX

sudo tee /Library/LaunchDaemons/com.electrans.inventario-agent.plist >/dev/null <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.electrans.inventario-agent</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/inventario-agent</string><string>run</string>
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>
EOF
sudo launchctl load /Library/LaunchDaemons/com.electrans.inventario-agent.plist
```

## Vincular agente con activo

En **Ajustes -> Agentes endpoint** veras los equipos enrolados. Pulsa
`vincular` e introduce el ID del activo correspondiente (autocompleta).
A partir de ese momento, cada checkin actualizara `asset_system_info` y
`asset_software` del activo. La pestaña "Info del sistema" y "Software
instalado" mostraran datos frescos directamente del agente, sin escanear
la red.

## Que datos envia

- **system_info**: OS, version, build, fabricante, modelo, BIOS, CPU, RAM,
  discos, interfaces de red.
- **software**: nombre, version, fabricante, fecha de instalacion, arquitectura.
- **metadata**: hostname, IP saliente, version del agente, machine_id.

No envia procesos en ejecucion, ficheros, ni datos de usuarios.

## Rotar enroll_key

Desde **Ajustes -> Agentes endpoint** -> boton "Rotar". Los agentes ya
enrolados siguen funcionando (usan su token propio); solo afecta a nuevos
enrolamientos.

## Desinstalar

```bash
sudo systemctl disable --now inventario-agent
sudo rm /usr/local/bin/inventario-agent /etc/systemd/system/inventario-agent.service
sudo rm -rf /etc/inventario-agent
```

Despues, desde **Ajustes -> Agentes endpoint** pulsa el icono de papelera
para borrar el registro en el backend.
