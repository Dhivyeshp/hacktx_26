#!/usr/bin/env python3
"""Copy only relay configuration from .env into the development app, without logging secrets."""
import os
import plistlib
import sys
from pathlib import Path
from urllib.parse import urlparse


def read_env(path):
    values = {}
    if not path.exists():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('export '):
            line = line[7:].strip()
        key, separator, value = line.partition('=')
        if not separator or key.strip() not in ('RELAY_URL', 'RELAY_ROOM', 'RELAY_TOKEN'):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        values[key.strip()] = value
    return values


def write_config(source, destination):
    values = read_env(source)
    url = values.get('RELAY_URL', 'wss://centerpiece-relay.onrender.com/ws')
    parsed = urlparse(url)
    if parsed.scheme != 'wss' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('RELAY_URL must be a wss:// URL without credentials, query parameters, or fragments')
    config = {'url': url, 'room': values.get('RELAY_ROOM', 'table') or 'table',
              'token': values.get('RELAY_TOKEN', '').strip()}
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(plistlib.dumps(config))
    destination.chmod(0o600)


if __name__ == '__main__':
    try:
        root = Path(os.environ['SRCROOT'])
        output = Path(os.environ['TARGET_BUILD_DIR']) / os.environ['UNLOCALIZED_RESOURCES_FOLDER_PATH'] / 'RelayConfig.plist'
        write_config(root / '.env', output)
    except (OSError, ValueError, KeyError):
        print('error: Could not generate relay configuration. Check .env and Xcode build settings.', file=sys.stderr)
        sys.exit(1)
