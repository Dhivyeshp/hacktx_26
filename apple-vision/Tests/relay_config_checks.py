"""Check the build-time configuration without reading developer credentials."""
import importlib.util
import plistlib
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    'build_relay_config', Path(__file__).parents[1] / 'Scripts/build_relay_config.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class RelayConfigChecks(unittest.TestCase):
    def generate(self, text=None):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / '.env'
            destination = Path(directory) / 'RelayConfig.plist'
            if text is not None:
                source.write_text(text)
            config.write_config(source, destination)
            return plistlib.loads(destination.read_bytes())

    def test_missing_env_uses_hotspot_without_auth(self):
        self.assertEqual(self.generate(), {
            'url': 'ws://172.20.10.9:8080/ws', 'room': 'table', 'token': ''})

    def test_example_uses_hotspot_without_auth(self):
        self.assertEqual(self.generate((Path(__file__).parents[1] / '.env.example').read_text()),
                         self.generate())

    def test_secure_relay_can_still_be_configured(self):
        self.assertEqual(self.generate('RELAY_URL=wss://relay.example/ws\nRELAY_ROOM=other\nRELAY_TOKEN="test-token"'), {
            'url': 'wss://relay.example/ws', 'room': 'other', 'token': 'test-token'})

    def test_invalid_urls_are_rejected(self):
        for url in ('http://localhost/ws', 'ws:///ws', 'ws://user:secret@localhost/ws',
                    'ws://localhost/ws?token=secret', 'ws://localhost/ws#fragment'):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.generate(f'RELAY_URL={url}')


if __name__ == '__main__':
    unittest.main()
