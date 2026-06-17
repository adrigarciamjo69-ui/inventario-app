#!/usr/bin/env python3
"""WMI query helper para el backend de inventario.

Usa impacket (>=0.12) para hablar DCOM/RPC con un host Windows y extraer datos
del sistema. Antes solo sacabamos hostname/vendor/model/serial/os; ahora
tambien CPU, RAM, motherboard, BIOS, GPU, audio, discos (fisicos y logicos),
adaptadores de red, AD y usuario actual.

Salida en stdout (una linea JSON):
{
  hostname, vendor, model, serial, os,  # campos planos para retrocompatibilidad
  system_info: {
    os:        { name, version, build, architecture, install_date, last_boot, language, locale },
    hardware:  { manufacturer, model, sku, system_type, system_family,
                 cpu: [{name, cores, threads, speed_mhz, manufacturer}],
                 memory: { total_gb, modules: [{capacity_gb, speed, manufacturer, part_number, slot}] },
                 motherboard: {manufacturer, product, serial},
                 bios: {vendor, version, release_date, serial},
                 graphics: [{name, driver_version, ram_mb}],
                 audio: [{name, manufacturer}],
                 disks_physical: [{model, size_gb, interface, serial}],
                 disks_logical:  [{drive, filesystem, size_gb, free_gb}] },
  network:   [{description, mac, ip, gateway, dns, dhcp}],
  ad:        { domain, workgroup, part_of_domain, domain_role },
  last_user: "..."
  }
}

En caso de error: stderr con JSON {error, stage, impacket, trace} y exit != 0.
"""
import sys, json, argparse, signal, traceback, re

def _impacket_version():
    try:
        import impacket
        return getattr(impacket, '__version__', '?')
    except Exception:
        return 'no-instalado'

def fail(msg, code=1, stage=None, exc=None):
    payload = {"error": str(msg)[:400], "impacket": _impacket_version()}
    if stage:
        payload["stage"] = stage
    if exc is not None:
        tb_lines = traceback.format_exception(type(exc), exc, exc.__traceback__)
        compact = " | ".join(l.strip() for l in tb_lines if l.strip())[-500:]
        payload["trace"] = compact
    sys.stderr.write(json.dumps(payload) + "\n")
    sys.exit(code)

def safe_str(v):
    if v is None:
        return ''
    try:
        return str(v).strip()
    except Exception:
        return ''

def safe_int(v):
    try:
        if v is None or v == '':
            return None
        return int(v)
    except Exception:
        try:
            return int(float(v))
        except Exception:
            return None

def wmi_date_to_iso(s):
    # Formato WMI: '20240115093045.123456+060'
    if not s:
        return ''
    m = re.match(r'^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})', str(s))
    if not m:
        return safe_str(s)
    return "{}-{}-{}T{}:{}:{}".format(*m.groups())

DOMAIN_ROLES = {
    0: 'Standalone Workstation',
    1: 'Member Workstation',
    2: 'Standalone Server',
    3: 'Member Server',
    4: 'Backup Domain Controller',
    5: 'Primary Domain Controller',
}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', required=True)
    ap.add_argument('--user', required=True)
    ap.add_argument('--password', default='')
    ap.add_argument('--domain', default='')
    ap.add_argument('--timeout', type=int, default=30)
    ap.add_argument('--version', action='store_true', help='imprime version impacket y sale')
    args = ap.parse_args()

    if args.version:
        sys.stdout.write(json.dumps({"impacket": _impacket_version()}) + "\n")
        sys.exit(0)

    def _timeout(signum, frame):
        fail("timeout interno", code=3, stage="watchdog")
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(max(10, args.timeout))

    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
        from impacket.dcerpc.v5.dtypes import NULL
    except ImportError as e:
        fail("impacket no importable: " + str(e), code=2, stage="import")

    dcom = None
    iWbemServices = None
    out = {}
    sysinfo = {
        'os': {}, 'hardware': {}, 'network': [], 'ad': {}, 'last_user': ''
    }
    stage = "init"
    try:
        stage = "dcom_connect"
        dcom = DCOMConnection(
            args.host, args.user, args.password, args.domain,
            '', '', oxidResolver=True
        )
        stage = "cocreate"
        iInterface = dcom.CoCreateInstanceEx(wmi.CLSID_WbemLevel1Login, wmi.IID_IWbemLevel1Login)
        if iInterface is None:
            fail("CoCreateInstanceEx devolvio None (DCOM/RPC bloqueado o sin permisos de activacion)",
                 code=1, stage=stage)
        stage = "wbem_login"
        iWbemLevel1Login = wmi.IWbemLevel1Login(iInterface)
        stage = "ntlm_login"
        try:
            iWbemServices = iWbemLevel1Login.NTLMLogin('//./root/cimv2', NULL, NULL)
        except Exception as e:
            msg = str(e); low = msg.lower(); hint = ''
            if 'access_denied' in low or 'access denied' in low:
                hint = " -> permisos DCOM/WMI insuficientes"
            elif 'logon' in low or 'credential' in low:
                hint = " -> credenciales rechazadas"
            fail("NTLMLogin fallo: " + msg + hint, code=1, stage=stage, exc=e)
        if iWbemServices is None:
            fail("NTLMLogin devolvio None", code=1, stage=stage)
        try:
            iWbemLevel1Login.RemRelease()
        except Exception:
            pass

        def get_prop_value(props, key):
            p = props.get(key) if isinstance(props, dict) else None
            if p is None:
                return None
            try:
                if isinstance(p, dict):
                    return p.get('value')
                return getattr(p, 'value', None)
            except Exception:
                return None

        def query_rows(sql, max_rows=20):
            """Devuelve lista de dicts (un dict por fila) con propiedades crudas."""
            rows = []
            it = None
            try:
                it = iWbemServices.ExecQuery(sql)
                if it is None:
                    return rows
                count = 0
                while count < max_rows:
                    try:
                        nxt = it.Next(0xffffffff, 1)
                    except Exception:
                        break
                    if not nxt:
                        break
                    try:
                        pEnum = nxt[0]
                    except (TypeError, IndexError):
                        break
                    if pEnum is None:
                        break
                    try:
                        props = pEnum.getProperties() or {}
                    except Exception:
                        props = {}
                    rows.append(props)
                    count += 1
            except Exception:
                pass
            finally:
                if it is not None:
                    try:
                        it.RemRelease()
                    except Exception:
                        pass
            return rows

        # -------- ComputerSystem --------
        stage = "query_computersystem"
        rows = query_rows(
            "SELECT Manufacturer,Model,Name,SystemType,SystemSKUNumber,SystemFamily,"
            "UserName,PartOfDomain,Domain,Workgroup,DomainRole "
            "FROM Win32_ComputerSystem", 1)
        cs = rows[0] if rows else {}
        manufacturer = safe_str(get_prop_value(cs, 'Manufacturer'))
        model        = safe_str(get_prop_value(cs, 'Model'))
        hostname     = safe_str(get_prop_value(cs, 'Name'))
        sysinfo['hardware']['manufacturer']  = manufacturer
        sysinfo['hardware']['model']         = model
        sysinfo['hardware']['system_type']   = safe_str(get_prop_value(cs, 'SystemType'))
        sysinfo['hardware']['sku']           = safe_str(get_prop_value(cs, 'SystemSKUNumber'))
        sysinfo['hardware']['system_family'] = safe_str(get_prop_value(cs, 'SystemFamily'))
        sysinfo['last_user']                 = safe_str(get_prop_value(cs, 'UserName'))
        part_of_domain = get_prop_value(cs, 'PartOfDomain')
        sysinfo['ad']['part_of_domain'] = bool(part_of_domain) if part_of_domain is not None else False
        sysinfo['ad']['domain']    = safe_str(get_prop_value(cs, 'Domain'))
        sysinfo['ad']['workgroup'] = safe_str(get_prop_value(cs, 'Workgroup'))
        role_n = safe_int(get_prop_value(cs, 'DomainRole'))
        if role_n is not None:
            sysinfo['ad']['domain_role'] = DOMAIN_ROLES.get(role_n, 'role_' + str(role_n))

        # -------- BIOS --------
        stage = "query_bios"
        rows = query_rows(
            "SELECT SerialNumber,Manufacturer,Version,SMBIOSBIOSVersion,ReleaseDate FROM Win32_BIOS", 1)
        bios = rows[0] if rows else {}
        serial = safe_str(get_prop_value(bios, 'SerialNumber'))
        sysinfo['hardware']['bios'] = {
            'vendor':       safe_str(get_prop_value(bios, 'Manufacturer')),
            'version':      safe_str(get_prop_value(bios, 'SMBIOSBIOSVersion')) or safe_str(get_prop_value(bios, 'Version')),
            'release_date': wmi_date_to_iso(get_prop_value(bios, 'ReleaseDate')),
            'serial':       serial,
        }

        # -------- OS --------
        stage = "query_os"
        rows = query_rows(
            "SELECT Caption,Version,BuildNumber,OSArchitecture,InstallDate,LastBootUpTime,"
            "OSLanguage,Locale,CSName FROM Win32_OperatingSystem", 1)
        os_ = rows[0] if rows else {}
        os_name   = safe_str(get_prop_value(os_, 'Caption'))
        os_ver    = safe_str(get_prop_value(os_, 'Version'))
        os_build  = safe_str(get_prop_value(os_, 'BuildNumber'))
        sysinfo['os'] = {
            'name':         os_name,
            'version':      os_ver,
            'build':        os_build,
            'architecture': safe_str(get_prop_value(os_, 'OSArchitecture')),
            'install_date': wmi_date_to_iso(get_prop_value(os_, 'InstallDate')),
            'last_boot':    wmi_date_to_iso(get_prop_value(os_, 'LastBootUpTime')),
            'language':     safe_str(get_prop_value(os_, 'OSLanguage')),
            'locale':       safe_str(get_prop_value(os_, 'Locale')),
        }
        os_str = ' '.join([s for s in [os_name, os_ver, os_build] if s]).strip()

        # -------- Processor (puede haber varios sockets) --------
        stage = "query_processor"
        cpus = []
        for r in query_rows(
                "SELECT Name,NumberOfCores,NumberOfLogicalProcessors,MaxClockSpeed,Manufacturer "
                "FROM Win32_Processor", 4):
            cpus.append({
                'name':         safe_str(get_prop_value(r, 'Name')),
                'cores':        safe_int(get_prop_value(r, 'NumberOfCores')),
                'threads':      safe_int(get_prop_value(r, 'NumberOfLogicalProcessors')),
                'speed_mhz':    safe_int(get_prop_value(r, 'MaxClockSpeed')),
                'manufacturer': safe_str(get_prop_value(r, 'Manufacturer')),
            })
        if cpus:
            sysinfo['hardware']['cpu'] = cpus

        # -------- Memory --------
        stage = "query_memory"
        modules = []
        total_bytes = 0
        for r in query_rows(
                "SELECT Capacity,Speed,Manufacturer,PartNumber,DeviceLocator "
                "FROM Win32_PhysicalMemory", 16):
            cap = safe_int(get_prop_value(r, 'Capacity'))
            if cap:
                total_bytes += cap
            modules.append({
                'capacity_gb':  round(cap / (1024 ** 3), 1) if cap else None,
                'speed':        safe_int(get_prop_value(r, 'Speed')),
                'manufacturer': safe_str(get_prop_value(r, 'Manufacturer')),
                'part_number':  safe_str(get_prop_value(r, 'PartNumber')),
                'slot':         safe_str(get_prop_value(r, 'DeviceLocator')),
            })
        if modules:
            sysinfo['hardware']['memory'] = {
                'total_gb': round(total_bytes / (1024 ** 3), 1) if total_bytes else None,
                'modules':  modules,
            }

        # -------- Motherboard --------
        stage = "query_baseboard"
        rows = query_rows("SELECT Manufacturer,Product,SerialNumber FROM Win32_BaseBoard", 1)
        if rows:
            mb = rows[0]
            sysinfo['hardware']['motherboard'] = {
                'manufacturer': safe_str(get_prop_value(mb, 'Manufacturer')),
                'product':      safe_str(get_prop_value(mb, 'Product')),
                'serial':       safe_str(get_prop_value(mb, 'SerialNumber')),
            }

        # -------- Graphics --------
        stage = "query_video"
        gpus = []
        for r in query_rows(
                "SELECT Name,DriverVersion,AdapterRAM FROM Win32_VideoController", 8):
            ram = safe_int(get_prop_value(r, 'AdapterRAM'))
            gpus.append({
                'name':           safe_str(get_prop_value(r, 'Name')),
                'driver_version': safe_str(get_prop_value(r, 'DriverVersion')),
                'ram_mb':         round(ram / (1024 * 1024)) if ram else None,
            })
        if gpus:
            sysinfo['hardware']['graphics'] = gpus

        # -------- Audio --------
        stage = "query_sound"
        audios = []
        for r in query_rows("SELECT Name,Manufacturer FROM Win32_SoundDevice", 8):
            audios.append({
                'name':         safe_str(get_prop_value(r, 'Name')),
                'manufacturer': safe_str(get_prop_value(r, 'Manufacturer')),
            })
        if audios:
            sysinfo['hardware']['audio'] = audios

        # -------- Physical Disks --------
        stage = "query_disk_physical"
        disks_p = []
        for r in query_rows(
                "SELECT Model,Size,InterfaceType,SerialNumber FROM Win32_DiskDrive", 16):
            sz = safe_int(get_prop_value(r, 'Size'))
            disks_p.append({
                'model':     safe_str(get_prop_value(r, 'Model')),
                'size_gb':   round(sz / (1024 ** 3), 1) if sz else None,
                'interface': safe_str(get_prop_value(r, 'InterfaceType')),
                'serial':    safe_str(get_prop_value(r, 'SerialNumber')),
            })
        if disks_p:
            sysinfo['hardware']['disks_physical'] = disks_p

        # -------- Logical Disks --------
        stage = "query_disk_logical"
        disks_l = []
        for r in query_rows(
                "SELECT DeviceID,FileSystem,Size,FreeSpace FROM Win32_LogicalDisk WHERE DriveType=3", 16):
            sz = safe_int(get_prop_value(r, 'Size'))
            fr = safe_int(get_prop_value(r, 'FreeSpace'))
            disks_l.append({
                'drive':      safe_str(get_prop_value(r, 'DeviceID')),
                'filesystem': safe_str(get_prop_value(r, 'FileSystem')),
                'size_gb':    round(sz / (1024 ** 3), 1) if sz else None,
                'free_gb':    round(fr / (1024 ** 3), 1) if fr else None,
            })
        if disks_l:
            sysinfo['hardware']['disks_logical'] = disks_l

        # -------- Network adapters --------
        stage = "query_network"
        net = []
        for r in query_rows(
                "SELECT Description,MACAddress,IPAddress,DefaultIPGateway,"
                "DNSServerSearchOrder,DHCPEnabled FROM Win32_NetworkAdapterConfiguration "
                "WHERE IPEnabled=true", 8):
            def first_or_join(v):
                if v is None:
                    return ''
                if isinstance(v, (list, tuple)):
                    return ', '.join(str(x) for x in v if x)
                return safe_str(v)
            net.append({
                'description': safe_str(get_prop_value(r, 'Description')),
                'mac':         safe_str(get_prop_value(r, 'MACAddress')),
                'ip':          first_or_join(get_prop_value(r, 'IPAddress')),
                'gateway':     first_or_join(get_prop_value(r, 'DefaultIPGateway')),
                'dns':         first_or_join(get_prop_value(r, 'DNSServerSearchOrder')),
                'dhcp':        bool(get_prop_value(r, 'DHCPEnabled')),
            })
        sysinfo['network'] = net

        # -------- Software instalado (registro Uninstall via StdRegProv) --------
        # Camino limpio que evita Win32_Product (lento + dispara MSI reconfigure).
        # Se enumeran las claves de desinstalacion en HKLM (64 y 32 bits) y se
        # leen DisplayName/DisplayVersion/Publisher/InstallDate por subclave.
        stage = "query_software"
        HKLM = 0x80000002
        UNINSTALL_PATHS = [
            'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'SOFTWARE\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
        ]
        software = []
        try:
            reg = None
            try:
                reg, _ = iWbemServices.GetObject('StdRegProv')
            except Exception:
                reg = None
            if reg is not None:
                def reg_str(subkey, value_name):
                    try:
                        r = reg.GetStringValue(HKLM, subkey, value_name)
                        # impacket devuelve un objeto con atributo sValue (a veces uValue).
                        v = getattr(r, 'sValue', None)
                        if v is None:
                            v = getattr(r, 'uValue', None)
                        return safe_str(v) if v else ''
                    except Exception:
                        return ''
                for base in UNINSTALL_PATHS:
                    try:
                        ek = reg.EnumKey(HKLM, base)
                        names = getattr(ek, 'sNames', None) or []
                    except Exception:
                        names = []
                    # Limite alto pero acotado (algunos equipos tienen muchas entradas
                    # de actualizaciones; en cualquier caso filtramos por DisplayName).
                    for sk in list(names)[:400]:
                        full = base + '\\' + sk
                        display = reg_str(full, 'DisplayName')
                        if not display:
                            continue  # Las entradas sin DisplayName suelen ser parches/KB.
                        # SystemComponent=1 -> componentes internos, los excluimos.
                        try:
                            sc = reg.GetDWORDValue(HKLM, full, 'SystemComponent')
                            sc_val = getattr(sc, 'uValue', None)
                            if sc_val and int(sc_val) == 1:
                                continue
                        except Exception:
                            pass
                        software.append({
                            'name':         display,
                            'version':      reg_str(full, 'DisplayVersion'),
                            'publisher':    reg_str(full, 'Publisher'),
                            'install_date': reg_str(full, 'InstallDate'),  # YYYYMMDD
                            'arch':         '32-bit' if 'Wow6432Node' in base else '64-bit',
                        })
            # Dedupe por (name, version, publisher) y orden alfabetico.
            seen = set()
            deduped = []
            for a in software:
                key = (a.get('name', '').lower(), a.get('version', ''), a.get('publisher', ''))
                if key in seen:
                    continue
                seen.add(key)
                deduped.append(a)
            deduped.sort(key=lambda x: (x.get('name') or '').lower())
            sysinfo['software_count'] = len(deduped)
            out['software'] = deduped
        except Exception as e:
            # Si falla la enumeracion no rompemos el resto del informe.
            out['software'] = []
            sysinfo['software_count'] = 0
            sysinfo['software_error'] = str(e)[:200]

        # -------- Salida plana (retrocompat) --------
        out['hostname'] = hostname
        out['vendor']   = manufacturer or safe_str(get_prop_value(bios, 'Manufacturer'))
        out['model']    = model
        out['serial']   = serial
        out['os']       = os_str
        out['system_info'] = sysinfo

        if not any([hostname, manufacturer, model, serial, os_str]):
            fail("WMI autentico pero todas las consultas vinieron vacias (permisos de lectura en root/cimv2?)",
                 code=1, stage="empty_result")
    except SystemExit:
        raise
    except Exception as e:
        fail("wmi: " + str(e), code=1, stage=stage, exc=e)
    finally:
        if dcom:
            try:
                dcom.disconnect()
            except Exception:
                pass

    sys.stdout.write(json.dumps(out, default=str) + "\n")

if __name__ == '__main__':
    main()
