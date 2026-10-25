import motor_server as ms


def test_drive_valid():
    assert ms.parse_command('{"type":"drive","left":0.5,"right":-0.4}') == {
        "type": "drive", "left": 0.5, "right": -0.4}


def test_stop_and_heartbeat():
    assert ms.parse_command('{"type":"stop"}') == {"type": "stop"}
    assert ms.parse_command('{"type":"heartbeat"}') == {"type": "heartbeat"}


def test_rejects_malformed():
    for raw in ["nope", "[]", '{"type":"fly"}', '{"type":"drive","left":1}',
                '{"type":"drive","left":"1","right":0}', '{"type":"drive","left":true,"right":0}',
                '{"type":"drive","left":NaN,"right":0}']:
        assert ms.parse_command(raw) is None, raw


def test_clamp_caps_speed():
    assert ms.clamp(5, 0.5) == 0.5
    assert ms.clamp(-5, 0.5) == -0.5
    assert ms.clamp(0.2, 0.5) == 0.2


class FakeDrive:
    def __init__(self):
        self.calls = []

    def drive(self, l, r):
        self.calls.append(("drive", l, r))

    def stop(self):
        self.calls.append(("stop",))


def test_watchdog_stops_when_stale():
    import asyncio

    async def run():
        d = FakeDrive()
        s = ms.MotorServer(d)
        s.last_cmd -= 1.0
        task = asyncio.create_task(s.watchdog())
        await asyncio.sleep(0.12)
        task.cancel()
        return d.calls

    assert ("stop",) in asyncio.run(run())
