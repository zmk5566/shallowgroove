"""Verify final Portable or --installer payload outside the checkout using Wine."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys

project = Path(__file__).resolve().parent.parent
root = Path(tempfile.mkdtemp(prefix='shallowgroove-exe-', dir='/private/tmp'))
version = json.loads((project/'package.json').read_text())['version']
edition = 'private' if '--private' in sys.argv else 'public'
exe = project / 'release' / edition / (f'installer/ShallowGroove-Setup-{version}.exe' if '--installer' in sys.argv else f'portable/ShallowGroove-v{version}-Portable.exe')
subprocess.run(['7zz', 'x', str(exe), '-o' + str(root / 'outer'), '-y'], check=True, stdout=subprocess.DEVNULL)
app = root / 'app'
subprocess.run(['7zz', 'x', str(root / 'outer/$PLUGINSDIR/app-64.7z'), '-o' + str(app), '-y'], check=True, stdout=subprocess.DEVNULL)
assert json.loads((app/'resources/app/package.json').read_text())['version'] == version
subprocess.run(['node',str(project/'desktop/check-windows-branding.mjs'),str(exe),str(app/'ShallowGroove.exe')],check=True)
assert (app / 'resources/app/node_modules/@deepseek-ai/dsh-scope/package.json').is_file()
assert not list((app / 'resources/app/node_modules/@deepseek-ai').glob('libreoffice-kit*'))
files = [path for path in app.rglob('*') if path.is_file()]
music_files = [path for path in (app / 'resources/app').rglob('*') if path.is_file()]
assert len(music_files) < 5000, f'Unexpected music runtime file count: {len(music_files)}'
assert (app / 'resources/connect-service/python/python.exe').is_file()
for unused in ['openai', '@anthropic-ai/sdk', '@deepseek-ai/dsh-experimental-inspector']:
    assert not (app / 'resources/app/node_modules' / unused).exists(), unused
print(f'PASS: lean runtime has {len(files)} files', flush=True)
for path in app.rglob('*'):
    if path.is_symlink():
        assert path.resolve().is_relative_to(app), f'External symlink: {path}'
assert (app / 'resources/app/desktop/private-config.json').is_file() == (edition == 'private')
print('PASS: final EXE extracted outside checkout; dependency, symlinks and private configuration checked', flush=True)
Path('/private/tmp/shallowgroove-exe-check-path').write_text(str(root))
env = {**os.environ, 'WINEPREFIX': '/private/tmp/shallowgroove-wine-check', 'WINEDEBUG': '-all', 'MVK_CONFIG_LOG_LEVEL': '0', 'SHALLOWGROOVE_CHECK_SERVER': 'Z:' + str(app / 'resources/app/desktop/server.mjs')}
service = app / 'resources/connect-service'
assert not (service / 'python/Lib/site-packages/serial').exists()
with (root / 'python.log').open('w') as log:
    native = subprocess.run(['wine', str(service/'python/python.exe'), 'Z:'+str(service/'desktop/launcher.py'), '--hexblocks-source', 'Z:'+str(service/'shared/frontend/bridge'), '--smoke'], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=60)
print((root / 'python.log').read_text(), flush=True)
native.check_returncode()
with (root / 'backend.log').open('w') as log:
    for args in [['--test', str(project / 'desktop/ports.test.mjs')], [str(app / 'resources/app/desktop/check-services.cjs'), str(app / 'resources')], [str(app / 'resources/app/desktop/check.mjs'), *(['--live'] if '--live' in sys.argv else [])]]:
        result = subprocess.run(['wine', str(app / 'resources/runtime/node.exe'), *args], cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, timeout=120)
        if result.returncode:
            break
print((root / 'backend.log').read_text())
result.check_returncode()
print(root)
