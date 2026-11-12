import asyncio
import json
import sys

from ardia_cli import control
from ardia_cli.control import MethodError, Unreachable

GROUP_DESCRIPTION = """\
Make and arrange the sidebar's groups (folders). Tab and group ids come from ardia windows.

Exit status: 0 done, 1 refused or no such tab, group or window, 2 Ardia can't be reached (or the connection dropped
after the request went out, so the change may or may not have happened).

Examples:
  ardia group create --name Work 11 12
  ardia group create --name Reading --pinned 13
  ardia group move 14 --group g-abc --index 0
  ardia group move 14 --top
  ardia group rename g-abc "Deep work"
"""


def add_parser(commands, formatter, data_dir):
    parser = commands.add_parser("group", help="make and arrange sidebar groups", description=GROUP_DESCRIPTION, formatter_class=formatter)
    sub = parser.add_subparsers(dest="group_command", metavar="<command>")

    create = data_dir(sub.add_parser("create", help="group tabs under a name", description="Group TABs (one window, one profile; no pinned tiles) and print the new group's id.\nWhen every TAB is already in one group, the new group nests inside it."))
    create.add_argument("tabs", nargs="+", metavar="TAB", help="tab ids from ardia windows")
    create.add_argument("--name", default="", help="the group's name (default: Ardia's automatic one)")
    create.add_argument("--pinned", action="store_true", help="put the group in the pinned section")
    create.add_argument("--window", metavar="ID", help="refuse unless the tabs are in this window")
    create.add_argument("--json", action="store_true", help="print the reply as JSON")

    move = data_dir(sub.add_parser("move", help="move a tab into a group, out of one, or to a position", description="Move TAB into --group, out to the top of the sidebar's list with --top, or within where it is.\n--index counts the destination's items from 0, a nested group counting as one; past the end, or\nwithout it, the tab goes last. A pinned tab moved this way is unpinned."))
    move.add_argument("tab", metavar="TAB", help="a tab id from ardia windows")
    where = move.add_mutually_exclusive_group()
    where.add_argument("--group", metavar="ID", help="a group id from ardia windows")
    where.add_argument("--top", action="store_true", help="out of its groups, to the unpinned list")
    move.add_argument("--index", type=int, metavar="N", help="the position among the destination's items, from 0")
    move.add_argument("--json", action="store_true", help="print the reply as JSON")

    rename = data_dir(sub.add_parser("rename", help="rename a group", description="Rename GROUP. An empty NAME brings back Ardia's automatic name."))
    rename.add_argument("group", metavar="GROUP", help="a group id from ardia windows")
    rename.add_argument("name", metavar="NAME", help="the new name")
    rename.add_argument("--json", action="store_true", help="print the reply as JSON")


def parse_id(text: str):
    return int(text) if text.isdigit() and len(text) < 16 else text


def request(args) -> tuple[str, dict]:
    if args.group_command == "create":
        params = {"tabs": [parse_id(t) for t in args.tabs], "name": args.name, "pinned": args.pinned}
        if args.window is not None:
            params["window"] = parse_id(args.window)
        return "createGroup", params
    if args.group_command == "move":
        params = {"tab": parse_id(args.tab)}
        if args.top:
            params["group"] = None
        elif args.group is not None:
            params["group"] = parse_id(args.group)
        if args.index is not None:
            params["index"] = args.index
        return "moveTab", params
    return "renameGroup", {"group": parse_id(args.group), "name": args.name}


def describe(command: str, result) -> str:
    if command == "create":
        return str(result.get("groupId", "")) if isinstance(result, dict) else ""
    if command == "move":
        group = result.get("group") if isinstance(result, dict) else None
        return f"moved into group {group}" if group is not None else "moved to the top level"
    return "renamed"


def complain(text: str) -> None:
    sys.stdout.flush()
    sys.stderr.write(text + "\n")
    sys.stderr.flush()


def run(args, parser) -> int:
    if args.group_command is None:
        parser.parse_args(["group", "--help"])
        return 0
    method, params = request(args)

    async def work():
        connection = await control.connect(control.socket_path(args.data_dir))
        try:
            return await connection.call(method, params)
        finally:
            await connection.close()

    try:
        result = asyncio.run(work())
    except KeyboardInterrupt:
        complain(f"ardia group {args.group_command}: interrupted")
        return 130
    except Unreachable as error:
        if error.sent:
            complain(f"ardia group {args.group_command}: the connection dropped after the request went out, so it may or may not have happened ({error})")
        else:
            complain(f"ardia: {error}")
        return 2
    except MethodError as error:
        complain(f"ardia group {args.group_command}: {error.message}")
        return 1
    sys.stdout.write((json.dumps(result, ensure_ascii=False) if args.json else describe(args.group_command, result)) + "\n")
    sys.stdout.flush()
    return 0
