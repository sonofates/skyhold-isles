"""Run one QA command against a short-lived `vite preview` (started here, always stopped here).

Usage: python3 qa/withPreview.py [--port=4391] node qa/flowshots.mjs --size=1920x1080
(the QA script gets `--base=http://127.0.0.1:<port>` appended when a port is given). Starts vite
directly (not via npx: terminating npx can orphan the vite child) and refuses a port already taken
(another checkout's preview would serve a stale build).
"""
import socket
import subprocess
import sys
import time

PORT = 4381
cmd = sys.argv[1:]
if cmd and cmd[0].startswith('--port='):
    PORT = int(cmd[0].split('=', 1)[1])
    cmd = cmd[1:] + [f'--base=http://127.0.0.1:{PORT}']
try:
    socket.create_connection(('127.0.0.1', PORT), timeout=0.5).close()
    print(f'port {PORT} is already in use: pick another --port')
    sys.exit(2)
except OSError:
    pass
srv = subprocess.Popen(['node', 'node_modules/vite/bin/vite.js', 'preview', '--port', str(PORT), '--strictPort'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(120):
        try:
            socket.create_connection(('127.0.0.1', PORT), timeout=0.5).close()
            break
        except OSError:
            time.sleep(0.5)
    else:
        print('preview did not start')
        sys.exit(2)
    r = subprocess.run(cmd, capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print('\n'.join(out[-30:]))
    sys.exit(r.returncode)
finally:
    srv.terminate()
    try:
        srv.wait(timeout=10)
    except subprocess.TimeoutExpired:
        srv.kill()
