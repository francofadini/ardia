import asyncio
import logging
import os
import re
from pathlib import Path

from ardia_cli import control

log = logging.getLogger("ardia_cli")
MAX_NAME = 40
_SPACE = re.compile(r"[\s\x00-\x1f\x7f]+")


def controller_name(env=None) -> str | None:
    env = os.environ if env is None else env
    explicit = _SPACE.sub(" ", env.get("ARDIA_CONTROLLER") or "").strip()[:MAX_NAME].strip()
    if explicit:
        return explicit
    if env.get("CLAUDECODE") == "1":
        return "Claude"
    return None


class Announcer:
    def __init__(self, data_root: Path):
        self.data_root = data_root
        self.connection = None
        self.wanted = None
        self.sent = None
        self.task = None
        self.unsupported = False

    def update(self, targets: list[dict], controller: str | None):
        wanted = (controller, tuple((t["targetId"], t.get("url") or "") for t in targets))
        if wanted == self.wanted or self.unsupported:
            return
        self.wanted = wanted
        if self.task is None or self.task.done():
            self.task = asyncio.ensure_future(self._flush())

    async def _flush(self):
        while self.wanted != self.sent and not self.unsupported:
            wanted = self.wanted
            controller, targets = wanted
            params = {"targets": [{"targetId": target, "url": url or None} for target, url in targets]}
            if controller:
                params["controller"] = controller
            try:
                if self.connection is None or self.connection.closed:
                    self.connection = await control.open_control(self.data_root)
                await self.connection.call("controlling", params)
                self.sent = wanted
            except control.MethodError as error:
                if error.code == "unknown_method":
                    self.unsupported = True
                    return
                log.info("couldn't tell Ardia which tabs this session drives (%s)", error)
                self.wanted = self.sent
                return
            except Exception as error:
                log.info("couldn't tell Ardia which tabs this session drives (%s)", error)
                self.connection = None
                self.wanted = self.sent
                return

    async def start(self, controller: str | None):
        self.update([], controller)
        if self.task is not None:
            await asyncio.gather(self.task, return_exceptions=True)

    async def close(self):
        task, self.task = self.task, None
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        connection, self.connection = self.connection, None
        self.wanted = self.sent = None
        if connection is not None:
            try:
                await asyncio.wait_for(connection.close(), 3)
            except Exception:
                pass
