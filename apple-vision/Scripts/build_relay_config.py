#!/usr/bin/env python3
"""Copy only relay and Destina configuration from .env into the development app, without logging secrets."""
import os
import plistlib
import sys
from pathlib import Path
from urllib.parse import urlparse

ALLOWED = (
    'RELAY_URL', 'RELAY_ROOM', 'RELAY_TOKEN',
    'DESTINA_URL', 'DESTINA_ROOM', 'GM_API_KEY',
)


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
        if not separator or key.strip() not in ALLOWED:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in ('"', "'"):
            value = value[1:-1]
        values[key.strip()] = value
    return values


def checked_url(url, schemes, label):
    parsed = urlparse(url)
    if parsed.scheme not in schemes or not parsed.hostname:
        raise ValueError(f'{label} must use one of {schemes}')
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError(f'{label} must not carry credentials, query parameters, or fragments')
    # Plaintext HTTP would send the Game Master key in the clear. Allow it only
    # for a developer's own machine, where the traffic does not leave the host.
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1'):
        raise ValueError('DESTINA_URL must use https:// unless it points at localhost')
    return url.rstrip('/')


def write_config(source, destination):
    values = read_env(source)
    url = checked_url(values.get('RELAY_URL', 'wss://centerpiece-relay.onrender.com/ws'),
                      ('wss',), 'RELAY_URL')
    config = {'url': url, 'room': values.get('RELAY_ROOM', 'table') or 'table',
              'token': values.get('RELAY_TOKEN', '').strip()}
    destina = values.get('DESTINA_URL', '').strip()
    if destina:
        config['destinaURL'] = checked_url(destina, ('https', 'http'), 'DESTINA_URL')
        config['destinaRoom'] = values.get('DESTINA_ROOM', '').strip().upper()
        config['destinaKey'] = values.get('GM_API_KEY', '').strip()
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
