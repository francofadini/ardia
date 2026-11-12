import asyncio
import json
import sys

from ardia_cli import control
from ardia_cli.control import MethodError, Unreachable

WINDOW_DESCRIPTION = """\
Close one of Ardia's windows, for cleanup. Window ids come from ardia windows.

A window an agent opened (ardia browse window new) closes with its tabs. Any other window closes as
Close Window does: with Share tabs across windows on, its tabs stay in the profile's other windows.

Exit status: 0 closed, 1 no such window, 2 Ardia can't be reached (or the connection dropped after the
request went out, so it may or may not have closed).

Examples:
  ardia window close w-abc
"""


def add_parser(commands, formatter, data_dir):
    parser = commands.add_parser("window", help="close a window", description=WINDOW_DESCRIPTION, formatter_class=formatter)
    sub = parser.add_subparsers(dest="window_command", metavar="<command>")
    close = data_dir(sub.add_parser("close", help="close a window", description="Close WINDOW (an id from ardia windows)."))
    close.add_argument("window", metavar="WINDOW", help="a window id from ardia windows")
    close.add_argument("--json", action="store_true", help="print the reply as JSON")


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def run(args, parser) -> int:
    if args.window_command is None:
        parser.parse_args(["window", "--help"])
        return 0

    async def work():
        connection = await control.connect(control.socket_path(args.data_dir))
        try:
            return await connection.call("closeWindow", {"window": args.window})
        finally:
            await connection.close()

    try:
        result = asyncio.run(work())
    except KeyboardInterrupt:
        complain("ardia window close: interrupted")
        return 130
    except Unreachable as error:
        if error.sent:
            complain(f"ardia window close: the connection dropped after the request went out, so it may or may not have closed ({error})")
        else:
            complain(f"ardia: {error}")
        return 2
    except MethodError as error:
        complain(f"ardia window close: {error.message}")
        return 1
    sys.stdout.write((json.dumps(result, ensure_ascii=False) if args.json else f"closed {args.window}") + "\n")
    sys.stdout.flush()
    return 0
