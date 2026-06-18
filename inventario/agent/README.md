# InventarioIT - Agentes remotos

Esta carpeta añade la opción B: agentes instalables en equipos Windows/Linux que envían inventario al backend central sin que el servidor tenga que escanear la red de la delegación.

## Qué se ha añadido

### Backend

Nuevo endpoint público autenticado por token de agente:

```http
POST /api/agents/report
Authorization: Bearer invagt_...
Content-Type: application/json
```

El backend guarda cada reporte como resultado de descubrimiento (`scan_results`) y, si el equipo ya existe por número de serie, actualiza automáticamente:

- `asset_system_info`
- `asset_software`

Si el token tiene `auto_import=true`, el backend también puede crear el activo automáticamente cuando llegue un equipo nuevo con serie, marca y modelo.

### Administración web

Nueva sección de menú: **Agentes**.

Permite:

- Crear tokens de agente.
- Ver último reporte, IP, hostname, SO y versión.
- Habilitar/deshabilitar tokens.
- Activar alta automática.
- Regenerar tokens.
- Eliminar tokens.

### Agente Windows

Archivos:

- `agent/windows/inventory-agent.ps1`
- `agent/windows/install-scheduled-task.ps1`

Recoge inventario mediante PowerShell/CIM y software instalado desde el registro, evitando `Win32_Product`.

### Agente Linux

Archivos:

- `agent/linux/inventory-agent.py`
- `agent/linux/install.sh`
- `agent/linux/inventory-agent.service`
- `agent/linux/inventory-agent.timer`

Recoge inventario con herramientas estándar (`/etc/os-release`, `ip`, `lsblk`, `df`, `dpkg-query` o `rpm`).

## Instalación Windows

1. Entra en la app como administrador.
2. Ve a **Agentes**.
3. Crea un token.
4. Copia la carpeta `agent/windows` al equipo Windows.
5. Ejecuta PowerShell como administrador:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-scheduled-task.ps1 -ApiUrl "https://TU_SERVIDOR/api" -Token "invagt_TOKEN" -Delegation "Delegacion"
```

Esto crea una tarea programada diaria que ejecuta el agente como `SYSTEM`.

## Instalación Linux

1. Entra en la app como administrador.
2. Ve a **Agentes**.
3. Crea un token.
4. Copia la carpeta `agent/linux` al equipo Linux.
5. Ejecuta:

```bash
sudo ./install.sh https://TU_SERVIDOR/api invagt_TOKEN "Delegacion"
```

Esto instala el agente en `/opt/inventario-agent`, crea `/etc/inventario-agent.env` y activa un `systemd timer` diario.

## Variables de entorno compatibles

Tanto Windows como Linux admiten:

```text
INVENTARIO_API_URL=https://TU_SERVIDOR/api
INVENTARIO_AGENT_TOKEN=invagt_...
INVENTARIO_DELEGATION=Delegacion
```

## Seguridad

- Usa HTTPS siempre que el backend sea accesible desde delegaciones.
- El token solo se muestra una vez al crearlo o regenerarlo.
- En la base de datos solo se guarda el hash SHA-256 del token.
- Puedes deshabilitar o regenerar tokens desde la sección **Agentes**.

## Flujo de datos

```text
Equipo Windows/Linux
  -> agente local
  -> POST /api/agents/report
  -> scan_results
  -> asset_system_info / asset_software si hay activo asociado
  -> alta automática opcional si no existe activo
```

## Prueba rápida del endpoint

```bash
curl -X POST "https://TU_SERVIDOR/api/agents/report" \
  -H "Authorization: Bearer invagt_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"hostname":"test-pc","serial_number":"TEST123","brand":"Test","model":"VM","os":"Linux","system_info":{"os":{"pretty_name":"Test"}},"software":[]}'
```
