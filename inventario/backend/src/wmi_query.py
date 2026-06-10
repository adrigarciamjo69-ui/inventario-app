#!/usr/bin/env python3
"""WMI query helper para el backend de inventario (Fase 2 - opcion B).

Usa impacket (python3-impacket) para hablar DCOM/RPC con un host Windows
y extraer datos basicos del sistema (fabricante, modelo, n. serie, SO).
Es el mismo metodo que utiliza Lansweeper para los equipos Windows.

Salida: una linea JSON en stdout con { hostname, vendor, model, serial, os }.
En caso de error: stderr con JSON {error, stage, trace} y codigo de salida != 0.

Uso (desde scanner.js):
  python3 wmi_query.py --host 10.10.0.5 --user adminuser --password X \\
          --domain MIDOMINIO --timeout 15
"""
import sys, json, argparse, signal, traceback

def fail(msg, code=1, stage=None, exc=None):
    payload = {"error": str(msg)[:400]}
    if stage:
        payload["stage"] = stage
    if exc is not None:
        # Trace compacto: solo las 4 ultimas frames
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
    args = ap.parse_args()

    # Watchdog global por si impacket se atasca
    def _timeout(signum, frame):
        fail("timeout interno", code=3, stage="watchdog")
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(max(5, args.timeout))

    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
    except ImportError as e:
        fail("impacket no instalado: " + str(e), code=2, stage="import")

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
            fail("CoCreateInstanceEx devolvio None (DCOM/RPC bloqueado o sin permisos)", code=1, stage=stage)

        stage = "wbem_login"
        iWbemLevel1Login = wmi.IWbemLevel1Login(iInterface)

        stage = "ntlm_login"
        iWbemServices = iWbemLevel1Login.NTLMLogin('\\\\.\\root\\cimv2', None, None)
        if iWbemServices is None:
            fail("NTLMLogin devolvio None (credenciales o WMI namespace no accesible)", code=1, stage=stage)
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
                # it.Next devuelve una tupla (objetos, ...). Defensivo si es None.
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
                    # p suele ser dict con clave 'value'
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
                # No abortamos por una query fallida; seguimos con las demas
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

        # Si TODO esta vacio reportamos error con la fase para poder diagnosticar
        if not any(out.values()):
            fail("WMI conecto pero todas las consultas vinieron vacias (permisos WMI/CIM?)",
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
