import asyncio
import unittest
from pathlib import Path
from unittest import mock

from ardia_cli import control
from ardia_cli.controller import Announcer, controller_name


class ControllerName(unittest.TestCase):
    def test_claude_code_is_claude(self):
        self.assertEqual(controller_name({"CLAUDECODE": "1"}), "Claude")

    def test_explicit_name_wins_and_is_cleaned(self):
        self.assertEqual(controller_name({"CLAUDECODE": "1", "ARDIA_CONTROLLER": "  My\tbot\n "}), "My bot")
        self.assertEqual(len(controller_name({"ARDIA_CONTROLLER": "x" * 100})), 40)

    def test_unknown_client_has_no_name(self):
        self.assertIsNone(controller_name({}))
        self.assertIsNone(controller_name({"ARDIA_CONTROLLER": "   "}))


class FakeConnection:
    def __init__(self, error=None):
        self.calls = []
        self.closed = False
        self.error = error

    async def call(self, method, params=None, timeout=None):
        self.calls.append((method, params))
        if self.error:
            raise self.error
        return {"ok": True}

    async def close(self):
        self.closed = True


class Announcing(unittest.TestCase):
    def run_with(self, connection, steps):
        async def go():
            with mock.patch.object(control, "open_control", mock.AsyncMock(return_value=connection)) as opened:
                announcer = Announcer(Path("/tmp/data"))
                await steps(announcer)
                return opened

        return asyncio.run(go())

    def test_sends_the_driven_targets_once_and_closes(self):
        connection = FakeConnection()

        async def steps(announcer):
            announcer.update([{"targetId": "T1", "url": "https://a.example/"}], "Claude")
            announcer.update([{"targetId": "T1", "url": "https://a.example/"}], "Claude")
            await announcer.task
            announcer.update([], "Claude")
            await announcer.task
            await announcer.close()

        opened = self.run_with(connection, steps)
        self.assertEqual(opened.await_count, 1)
        self.assertEqual(connection.calls, [
            ("controlling", {"targets": [{"targetId": "T1", "url": "https://a.example/"}], "controller": "Claude"}),
            ("controlling", {"targets": [], "controller": "Claude"}),
        ])
        self.assertTrue(connection.closed)

    def test_an_app_without_the_method_stops_it_asking(self):
        connection = FakeConnection(control.MethodError("unknown_method", "There's no method controlling."))

        async def steps(announcer):
            announcer.update([{"targetId": "T1", "url": None}], None)
            await announcer.task
            announcer.update([{"targetId": "T2", "url": None}], None)
            self.assertTrue(announcer.task.done())
            await announcer.close()

        self.run_with(connection, steps)
        self.assertEqual(connection.calls, [("controlling", {"targets": [{"targetId": "T1", "url": None}]})])


if __name__ == "__main__":
    unittest.main()
