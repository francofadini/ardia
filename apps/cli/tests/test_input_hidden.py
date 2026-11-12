import asyncio
import time
import unittest

from ardia_cli.browse import page as page_module
from ardia_cli.browse.page import HiddenMidway, Page


class NeverAnswers:
    def __init__(self):
        self.cancelled = False

    async def send(self, method, params=None, session=None, timeout=30):
        try:
            await asyncio.sleep(3600)
        except asyncio.CancelledError:
            self.cancelled = True
            raise


class Answers:
    async def send(self, method, params=None, session=None, timeout=30):
        await asyncio.sleep(0.05)
        return {"ok": True}


def fake_page(browser, hidden_after: float):
    page = Page.__new__(Page)
    page.browser = browser
    page.session_id = "S"
    page.main_frame = "F"
    started = time.monotonic()

    async def call(*_args, **_kwargs):
        return time.monotonic() - started >= hidden_after

    page.call = call
    return page


class InputOnAHiddenTab(unittest.TestCase):
    def setUp(self):
        self.poll = page_module.INPUT_VISIBILITY_POLL
        page_module.INPUT_VISIBILITY_POLL = 0.1

    def tearDown(self):
        page_module.INPUT_VISIBILITY_POLL = self.poll

    def test_a_tab_hidden_while_the_input_waits_fails_fast_with_tab_hidden(self):
        browser = NeverAnswers()
        page = fake_page(browser, hidden_after=0.2)

        async def go():
            started = time.monotonic()
            with self.assertRaises(HiddenMidway) as caught:
                await page.send("Input.dispatchMouseEvent", {"type": "mouseWheel"}, input_event=True)
            return caught.exception, time.monotonic() - started

        error, took = asyncio.run(go())
        self.assertEqual(error.code, "tab_hidden")
        self.assertLess(took, 2)
        self.assertTrue(browser.cancelled)

    def test_an_answered_input_on_a_visible_tab_returns_its_result(self):
        page = fake_page(Answers(), hidden_after=3600)
        self.assertEqual(asyncio.run(page.send("Input.dispatchMouseEvent", {"type": "mouseWheel"}, input_event=True)), {"ok": True})


if __name__ == "__main__":
    unittest.main()
