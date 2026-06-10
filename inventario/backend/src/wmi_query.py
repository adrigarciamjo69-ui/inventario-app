#!/usr/bin/env python3
"""WMI query helper para el backend de inventario (Fase 2 - opcion B).

Usa impacket (python3-impacket) para hablar DCOM/RPC con un host Windows
y extraer datos basicos del sistema (fabricante, modelo, n. serie, SO).
Es el mismo metodo que utiliza Lansweeper para los equipos Windows.

Salida: una linea JSON en stdout con { hostname, vendor, model, serial, os }.
En caso de error: stderr con JSON {error: ...} y codigo de salida != 0.

Uso (desde scanner.js):
  python3 wmi_query.py --host 10.10.0.5 --user adminuser --password X \
          --domain MIDOMINIO --timeout 15
"""
import sys, json, argparse, signal

def fail(msg, code=1):
    sys.stderr.write(json.dumps({"error": str(msg)[:300]}) + "\n")
    sys.exit(code)

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
        fail("timeout", code=3)
    signal.signal(signal.SIGALRM, _timeout)
    signal.alarm(max(5, args.timeout))

    try:
        from impacket.dcerpc.v5.dcomrt import DCOMConnection
        from impacket.dcerpc.v5.dcom import wmi
    except ImportError as e:
        fail("impacket no instalado: " + str(e), code=2)

    dcom = None
    out = {}
    try:
        dcom = DCOMConnection(
            args.host, args.user, args.password, args.domain,
            '', '', oxidResolver=True
        )
        iInterface = dcom.CoCreateInstanceEx(wmi.CLSID_WbemLevel1Login, wmi.IID_IWbemLevel1Login)
        iWbemLevel1Login = wmi.IWbemLevel1Login(iInterface)
        iWbemServices = iWbemLevel1Login.NTLMLogin('//./root/cimv2', None, None)
        iWbemLevel1Login.RemRelease()

        def query_one(sql, fields):
            try:
                it = iWbemServices.ExecQuery(sql)
                try:
                    pEnum = it.Next(0xffffffff, 1)[0]
                except Exception:
                    return {}
                props = pEnum.getProperties()
                res = {}
                for f in fields:
                    p = props.get(f)
                    if p and 'value' in p and p['value'] is not None:
                        res[f] = str(p['value']).strip()
                try:
                    it.RemRelease()
                except Exception:
                    pass
                return res
            except Exception:
                return {}

        cs = query_one(
            "SELECT Manufacturer,Model,Name FROM Win32_ComputerSystem",
            ['Manufacturer', 'Model', 'Name']
        )
        bios = query_one(
            "SELECT SerialNumber,Manufacturer FROM Win32_BIOS",
            ['SerialNumber', 'Manufacturer']
        )
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
    except Exception as e:
        fail("wmi: " + str(e), code=1)
    finally:
        if dcom:
            try:
                dcom.disconnect()
            except Exception:
                pass

    sys.stdout.write(json.dumps(out) + "\n")

if __name__ == '__main__':
    main()
