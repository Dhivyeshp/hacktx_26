import contextlib
import io
import json
import unittest

from listen_for_movement import CommandDisplay, handle_message


class MovementDisplayChecks(unittest.TestCase):
    def test_changes_heartbeats_stop_pair_and_senders(self):
        now = [0.0]
        display = CommandDisplay(clock=lambda: now[0])
        output = io.StringIO()
        base = dict(type="drive", to="pi", left=0.35, right=0.35,
                    **{"from": "visionpro", "fromId": "one"})
        messages = [base, dict(base, ts=1), dict(base, ts=2),
                    dict(base, left=0), dict(base, left=0, right=0),
                    dict(type="stop", to="pi", **{"from": "visionpro", "fromId": "one"}),
                    base, dict(base, fromId="two")]
        with contextlib.redirect_stdout(output):
            for index, msg in enumerate(messages):
                now[0] = index * 0.6
                self.assertTrue(handle_message(json.dumps(msg), display))
            display.flush()
        text = output.getvalue()
        self.assertEqual(text.count("WOULD SEND TO ROBOT:"), 5)
        self.assertIn("2 repeated messages hidden", text)
        self.assertIn("1 repeated messages hidden", text)
        self.assertIn("TURN LEFT", text)
        self.assertIn("visionpro/two", text)

    def test_verbose_preserves_every_payload(self):
        display = CommandDisplay(verbose=True)
        msg = dict(type="drive", left=0.35, right=0.35, ts=123)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            for _ in range(3):
                self.assertTrue(handle_message(json.dumps(msg), display))
        self.assertEqual(output.getvalue().count("WOULD SEND TO ROBOT: " + json.dumps(msg)), 3)

    def test_other_commands_and_invalid_drives_are_never_hidden(self):
        display = CommandDisplay()
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            for kind in ("dispense", "drive"):
                for _ in range(2):
                    self.assertTrue(handle_message(json.dumps(dict(type=kind)), display))
            self.assertFalse(handle_message(b"jpeg", display))
        self.assertEqual(output.getvalue().count("WOULD SEND TO ROBOT:"), 4)


if __name__ == "__main__":
    unittest.main()
