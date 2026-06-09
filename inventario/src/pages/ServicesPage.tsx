#12 1.558 ✗ Build failed in 611ms
#12 1.558 error during build:
#12 1.558 [vite:esbuild] Transform failed with 1 error:
#12 1.558 /app/src/pages/ServicesPage.tsx:14:0: ERROR: Unexpected "\u200b"
#12 1.558 file: /app/src/pages/ServicesPage.tsx:14:0
#12 1.558
#12 1.558 Unexpected "\u200b"
#12 1.558 12 |  import { Service, ServiceStatus, BillingCycle } from '../types';
#12 1.558 13 |  import { useAuth } from '../context/AuthContext';
#12 1.558 14 |  ​
#12 1.558    |  ^
#12 1.558 15 |  // ── Constants ─────────────────────────────────────────────────────────────────
#12 1.558 16 |  ​
#12 1.558
#12 1.558     at failureErrorWithLog (/app/node_modules/esbuild/lib/main.js:1748:15)
#12 1.558     at /app/node_modules/esbuild/lib/main.js:1017:50
#12 1.558     at responseCallbacks.<computed> (/app/node_modules/esbuild/lib/main.js:884:9)
#12 1.558     at handleIncomingPacket (/app/node_modules/esbuild/lib/main.js:939:12)
#12 1.558     at Socket.readFromStdout (/app/node_modules/esbuild/lib/main.js:862:7)
#12 1.558     at Socket.emit (node:events:524:28)
#12 1.558     at addChunk (node:internal/streams/readable:561:12)
#12 1.558     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
#12 1.558     at Readable.push (node:internal/streams/readable:392:5)
#12 1.558     at Pipe.onStreamRead (node:internal/stream_base_commons:191:23)
#12 ERROR: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1
------
> [builder 6/6] RUN npm run build:
1.558     at failureErrorWithLog (/app/node_modules/esbuild/lib/main.js:1748:15)
1.558     at /app/node_modules/esbuild/lib/main.js:1017:50
1.558     at responseCallbacks.<computed> (/app/node_modules/esbuild/lib/main.js:884:9)
1.558     at handleIncomingPacket (/app/node_modules/esbuild/lib/main.js:939:12)
1.558     at Socket.readFromStdout (/app/node_modules/esbuild/lib/main.js:862:7)
1.558     at Socket.emit (node:events:524:28)
1.558     at addChunk (node:internal/streams/readable:561:12)
1.558     at readableAddChunkPushByteMode (node:internal/streams/readable:512:3)
1.558     at Readable.push (node:internal/streams/readable:392:5)
1.558     at Pipe.onStreamRead (node:internal/stream_base_commons:191:23)
------
Dockerfile:16
--------------------
|
|     # Construimos la aplicación para producción (esto generará la carpeta 'dist')
| >>> RUN npm run build
|
|     # Etapa 2: Servidor web ligero (Nginx) para servir los archivos
--------------------
ERROR: failed to build: failed to solve: process "/bin/sh -c npm run build" did not complete successfully: exit code: 1
❌ Docker build failed
Error occurred ❌, check the logs for details.
