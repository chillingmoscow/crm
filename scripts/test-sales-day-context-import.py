"""Validate real source structure and failure cases without storing source data in Git."""
import copy
import importlib.util
import json
import sys
from datetime import datetime
from pathlib import Path

spec = importlib.util.spec_from_file_location("day_import", Path(__file__).with_name("prepare-sales-day-context.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
source, target, comments = [json.loads(Path(path).read_text()) for path in sys.argv[1:4]]
plan = module.prepare(source, target["legacy_venue_id"], comments, "Europe/London")
assert len({d["legacy_ref"] for d in plan["days"]}) == len(plan["days"])
assert plan["counts"]["members"] == sum(len(d["members"]) for d in plan["days"])
assert all(d["members"] for d in plan["days"])

def rejected(fn):
    try:
        fn()
    except ValueError:
        return
    raise AssertionError("Ambiguous source accepted")

wrong = copy.deepcopy(source)
wrong["sheets"]["Salary"]["values"][1][17] = "missing-shift"
rejected(lambda: module.prepare(wrong, target["legacy_venue_id"]))
wrong = copy.deepcopy(source)
wrong["sheets"]["Salary"]["values"].append(wrong["sheets"]["Salary"]["values"][1])
rejected(lambda: module.prepare(wrong, target["legacy_venue_id"]))
wrong = copy.deepcopy(source)
wrong["sheets"]["Shifts"]["values"][1][9] = "other-venue"
rejected(lambda: module.prepare(wrong, target["legacy_venue_id"]))
wrong = copy.deepcopy(source)
wrong["sheets"]["Shifts"]["values"][1][4] = None
empty = module.prepare(wrong, target["legacy_venue_id"])
assert empty["days"][0]["metrics"]["turnover"] is None
wrong["sheets"]["Shifts"]["values"][1][4] = 0
zero = module.prepare(wrong, target["legacy_venue_id"])
assert zero["days"][0]["metrics"]["turnover"] == 0

# Comment identity survives body changes and a changed processed flag; author/time
# remain part of the identity. The original source is never a replay instruction.
edited = copy.deepcopy(comments)
edited["rows"][0]["values"][2] = "QA ' $import$ \\ text"
edited["rows"][0]["values"][6] = True
changed = module.prepare(source, target["legacy_venue_id"], edited, "Europe/London")
assert changed["comments"][0]["source_ref"] == plan["comments"][0]["source_ref"]
assert changed["comments"][0]["source_snapshot"]["hash"] != plan["comments"][0]["source_snapshot"]["hash"]
sql = module.sql(changed, target)
assert sql.index("create temporary table") < sql.index("do $import$")
assert "QA '' $import$" in sql

def serial(iso):
    return (datetime.fromisoformat(iso) - module.EPOCH).total_seconds() / 86400

assert module.source_time(serial("2026-06-11T12:00:00"), "Europe/London")[0].endswith("11:00:00.000+00:00")
assert module.source_time(serial("2026-10-30T12:00:00"), "Europe/London")[0].endswith("12:00:00.000+00:00")
rejected(lambda: module.source_time(serial("2026-10-25T01:30:00"), "Europe/London"))
rejected(lambda: module.source_time(serial("2026-03-29T01:30:00"), "Europe/London"))
print("PASS: real day/crew/comment links, scope/duplicate rejection, unknown vs zero, stable comment identity, safe SQL quoting and source DST")
