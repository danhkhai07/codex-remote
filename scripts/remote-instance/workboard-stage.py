#!/usr/bin/env python3
"""Render accepted Workboard ancestor patch plus explicit dual-route compatibility.

Only the old configured Origin and optional canonical loopback preview Origin are
accepted. Gateway validates external preview Origin before rewriting it. Cookies,
CSRF, data paths, login/session code remain unchanged.
"""
import hashlib
from pathlib import Path
import sys

BASE_SHA = '4ef0bc4b12a9b2bff9b6149881e9c7becfa38f367dffbf23e3594cc6a0f18354'


def render(source):
    if hashlib.sha256(source).hexdigest() != BASE_SHA:
        raise ValueError('Workboard accepted source changed')
    old = '        return origin == expected and self.headers.get("Sec-Fetch-Site", "same-origin") != "cross-site"'
    new = '''        preview = (f"http://127.0.0.1:{self.server.server_port}"
                   if os.environ.get("WORKBOARD_ISOLATED_PREVIEW") == "1" else None)
        return (origin == expected or origin == preview) and self.headers.get("Sec-Fetch-Site", "same-origin") != "cross-site"'''
    text = source.decode()
    if text.count(old) != 1:
        raise ValueError('Workboard Origin preimage changed')
    return text.replace(old, new)


if __name__ == '__main__':
    source, output = map(Path, sys.argv[1:])
    with output.open('x') as f:
        f.write(render(source.read_bytes()))
