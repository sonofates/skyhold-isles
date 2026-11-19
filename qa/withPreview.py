"""Run one QA command against a short-lived `vite preview` (started here, always stopped here).

Usage: python3 qa/withPreview.py node qa/flowshots.mjs --size=1920x1080
"""
import socket
import subprocess
import sys
import time

PORT = 4381
srv = subprocess.Popen(['npx', 'vite', 'preview', '--port', str(PORT), '--strictPort'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
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
    r = subprocess.run(sys.argv[1:], capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print('\n'.join(out[-30:]))
    sys.exit(r.returncode)
finally:
    srv.terminate()
    try:
        srv.wait(timeout=10)
    except subprocess.TimeoutExpired:
        srv.kill()
