"""Commit gate: tsc, lint, test, sim:balance, build; stops at the first failure.

Usage: python3 qa/gate.py [tsc lint test balance build]
"""
import subprocess, sys
steps = sys.argv[1:] or ['tsc', 'lint', 'test', 'balance', 'build']
cmds = {
    'tsc': ['npx', 'tsc', '--noEmit'],
    'lint': ['npm', 'run', 'lint'],
    'test': ['npm', 'test'],
    'balance': ['npm', 'run', 'sim:balance'],
    'build': ['npm', 'run', 'build'],
}
for s in steps:
    r = subprocess.run(cmds[s], capture_output=True, text=True)
    out = (r.stdout + r.stderr).strip().splitlines()
    print(f'== {s}: exit {r.returncode}')
    print('\n'.join(out[-25:] if r.returncode else out[-4:]))
    if r.returncode:
        sys.exit(1)
print('GATE OK')
