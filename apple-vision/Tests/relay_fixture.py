#!/usr/bin/env python3
"""Minimal local WebSocket peer for exercising the real Swift client over TCP.
Matches relay/src/server.ts handshake, welcome, presence and binary JPEG contract.
No dependencies, credentials, real relay or hardware required.
"""
import base64
import hashlib
import json
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def frame(opcode, data):
    length = len(data)
    header = bytes([0x80 | opcode])
    if length < 126:
        header += bytes([length])
    elif length < 65536:
        header += bytes([126]) + struct.pack('!H', length)
    else:
        header += bytes([127]) + struct.pack('!Q', length)
    return header + data


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(5)
        request = b''
        while b'\r\n\r\n' not in request:
            block = self.request.recv(4096)
            if not block:
                return
            request += block
        lines = request.decode().split('\r\n')
        url = urlparse(lines[0].split()[1])
        headers = dict(line.split(': ', 1) for line in lines[1:] if ': ' in line)
        headers = {k.lower(): v for k, v in headers.items()}
        query = parse_qs(url.query)
        if headers.get('authorization') != 'Bearer fixture-token' or query != {'role': ['visionpro'], 'room': ['table'], 'video': ['1']}:
            self.server.errors.append('Unexpected auth or subscription')
            self.request.sendall(b'HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
            return
        key = headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
        accept = base64.b64encode(hashlib.sha1(key.encode()).digest())
        self.request.sendall(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + b'\r\n\r\n')
        self.server.connections += 1
        number = self.server.connections
        welcome = json.dumps({'type': 'welcome', 'role': 'visionpro', 'room': 'table', 'peers': [{'role': 'pi'}, {'role': 'visionpro'}]}).encode()
        try:
            self.request.sendall(frame(1, welcome))
            self.request.sendall(frame(1, b'invalid JSON'))
            self.request.sendall(frame(2, b'not a jpeg'))
            self.request.sendall(frame(2, self.server.jpeg.read_bytes()))
            # First connection deliberately goes stale, then drops; second stays up.
            time.sleep(5 if number == 1 else 15)
        except (OSError, BrokenPipeError):
            pass


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    with tempfile.TemporaryDirectory(prefix='centerpiece-ws-') as directory:
        with Server(('127.0.0.1', 0), Handler) as server:
            server.connections = 0
            server.errors = []
            server.jpeg = Path(directory) / 'frame.jpg'
            threading.Thread(target=server.serve_forever, daemon=True).start()
            try:
                result = subprocess.run([sys.argv[1], f'ws://127.0.0.1:{server.server_address[1]}/ws', str(server.jpeg)], timeout=30)
                assert not server.errors, server.errors
                assert server.connections == 2, f'Expected two connections, got {server.connections}'
                sys.exit(result.returncode)
            finally:
                server.shutdown()
