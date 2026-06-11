#!/usr/bin/env python3
"""WMI query helper para el backend de inventario (Fase 2 - opcion B).

Usa impacket (PyPI >=0.12) para hablar DCOM/RPC con un host Windows y extraer
datos basicos del sistema (fabricante, modelo, n. serie, SO). Es el mismo
metodo que utiliza Lansweeper para los equipos Windows.

Salida: una linea JSON en stdout con { hostname, vendor, model, serial, os }.
En caso de error: stderr con JSON {error, stage, impacket, trace} y exit != 0.

Uso (desde scanner.js):
  python3 wmi_query.py --host 10.10.0.5 --user adminuser --password X \\
          --domain MIDOMINIO --timeout 15
"""
import sys, json, argparse, signal, traceback

# Version de impacket instalada (se incluye en errores para diagnosticar deploy)
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', required=True)
    ap.add_argument('--user', required=True)
    ap.add_argument('--password', default='')
    ap.add_argument('--domain', default='')
    ap.add_argument('--timeout', type=int, default=15)
    ap.add_argument('--version', action='store_true', help='imprime version impacket y sale')
    args = ap.parse_args()

    if args.version:
        sys.stdout.write(json.dumps({"impacket": _impacket_version()}) + "\n")
        sys.exit(0)

    # Watchdog global por si impacket se atasca
    def _timeout(signum, frame):
        fail("timeout interno", code=3, stage="watchdog")
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(max(5, args.timeout))

    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
        from impacket.dcerpc.v5.dtypes import NULL
    except ImportError as e:
        fail("impacket no importable: " + str(e), code=2, stage="import")

    # Niveles de autenticacion RPC para endurecer la conexion DCOM.
    try:
        from impacket.dcerpc.v5.rpcrt import RPC_C_AUTHN_LEVEL_PKT_PRIVACY
    except Exception:
        RPC_C_AUTHN_LEVEL_PKT_PRIVACY = 6

    dcom = None
    iWbemServices = None
    out = {}
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
        # Namespace en formato canonico de impacket (wmiexec.py usa este).
        try:
            iWbemServices = iWbemLevel1Login.NTLMLogin('//./root/cimv2', NULL, NULL)
        except Exception as e:
            # impacket >=0.12 lanza excepcion con el fault RPC real; la 0.11
            # a veces devuelve None y revienta con 'NoneType subscriptable'.
            msg = str(e)
            hint = ""
            low = msg.lower()
            if 'access_denied' in low or 'access denied' in low or 'e_accessdenied' in low:
                hint = " -> permisos DCOM/WMI: la cuenta no tiene 'Remote Activation' o acceso a root/cimv2"
            elif 'logon' in low or 'credential' in low or 'rpc_s_sec_pkg_error' in low:
                hint = " -> credenciales rechazadas (usuario/dominio/contrasena)"
            elif 'subscriptable' in low:
                hint = " -> bug de impacket 0.11 (apt): el rebuild NO instalo impacket>=0.12 desde pip"
            fail("NTLMLogin fallo: " + msg + hint, code=1, stage=stage, exc=e)
        if iWbemServices is None:
            fail("NTLMLogin devolvio None (impacket 0.11 + Windows moderno: hace falta impacket>=0.12 via pip)",
                 code=1, stage=stage)
        try:
            iWbemLevel1Login.RemRelease()
        except Exception:
            pass

        def query_one(sql, fields):
            res = {}
            it = None
            try:
                it = iWbemServices.ExecQuery(sql)
                if it is None:
                    return res
                try:
                    nxt = it.Next(0xffffffff, 1)
                except Exception:
                    return res
                if not nxt:
                    return res
                try:
                    pEnum = nxt[0]
                except (TypeError, IndexError):
                    return res
                if pEnum is None:
                    return res
                try:
                    props = pEnum.getProperties() or {}
                except Exception:
                    return res
                for f in fields:
                    p = props.get(f) if isinstance(props, dict) else None
                    if p is None:
                        continue
                    val = None
                    try:
                        if isinstance(p, dict):
                            val = p.get('value')
                        else:
                            val = getattr(p, 'value', None)
                    except Exception:
                        val = None
                    s = safe_str(val)
                    if s:
                        res[f] = s
            except Exception:
                return res
            finally:
                if it is not None:
                    try:
                        it.RemRelease()
                    except Exception:
                        pass
            return res

        stage = "query_computersystem"
        cs = query_one(
            "SELECT Manufacturer,Model,Name FROM Win32_ComputerSystem",
            ['Manufacturer', 'Model', 'Name']
        )
        stage = "query_bios"
        bios = query_one(
            "SELECT SerialNumber,Manufacturer FROM Win32_BIOS",
            ['SerialNumber', 'Manufacturer']
        )
        stage = "query_os"
        os_ = query_one(
            "SELECT Caption,Version,BuildNumber FROM Win32_OperatingSystem",
            ['Caption', 'Version', 'BuildNumber']
        )

        out['hostname'] = cs.get('Name') or ''
        out['vendor']   = cs.get('Manufacturer') or bios.get('Manufacturer') or ''
        out['model']    = cs.get('Model') or ''
        out['serial']   = bios.get('SerialNumber') or ''
        os_parts = [s for s in [os_.get('Caption'), os_.get('Version'), os_.get('BuildNumber')] if s]
        out['os']       = ' '.join(os_parts).strip()

        if not any(out.values()):
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

    sys.stdout.write(json.dumps(out) + "\n")

if __name__ == '__main__':
    main()
