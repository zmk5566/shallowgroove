"""Exercise the installed Connect launcher with Windows bind failures injected."""
import argparse
import asyncio
from pathlib import Path
import sys
from unittest.mock import patch

service_root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(service_root))
sys.path.insert(0, str(service_root / 'desktop'))
from launcher import create_service
from aiohttp import ClientSession

async def check():
    loop = asyncio.get_running_loop()
    original = loop.create_server
    for number in (13, 10013):
        attempts = []
        async def bind(*args, **kwargs):
            port = args[2] if len(args) > 2 else kwargs.get('port')
            attempts.append(port)
            if port == 8766:
                error = PermissionError(number, 'Injected Windows bind denial')
                error.winerror = 10013
                raise error
            return await original(*args, **kwargs)
        args = argparse.Namespace(hexblocks_source=str(service_root/'shared/frontend/bridge'), server='', id='port-denied-check', name='Port denied check', sim=False, port=8766)
        with patch.object(loop, 'create_server', side_effect=bind):
            runner, _, port = await create_service(args)
        try:
            assert attempts == [8766, 0], attempts
            assert port > 0 and len(runner.sites) == 1
            async with ClientSession() as client:
                async with client.get(f'http://127.0.0.1:{port}/api/state') as response:
                    assert response.status == 200
                    assert (await response.json())['csrf']
        finally:
            await runner.cleanup()
    print('PASS: installed Windows Python/Connect survives errno 13 + winerror 10013 and direct errno 10013; fallback HTTP endpoint responds')

asyncio.run(check())
