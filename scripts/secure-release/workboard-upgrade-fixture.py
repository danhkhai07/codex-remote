"""Owned synthetic DB upgrade check; never opens or copies the live Workboard DB."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


with tempfile.TemporaryDirectory(prefix="workboard-upgrade-") as directory:
    root = Path(directory)
    candidate = Path("/root/WORKTREES/workboard-isolated-preview")
    old = subprocess.check_output(["git", "-C", str(candidate), "show", "bc66e80^:server.py"])
    assert hashlib.sha256(old).hexdigest() == "af0dbf18b31dc6a57586344d85cfa0b0394ea581b289a914130277bcd53c7e29"
    new = (candidate / "server.py").read_bytes()
    assert hashlib.sha256(new).hexdigest() == "4ef0bc4b12a9b2bff9b6149881e9c7becfa38f367dffbf23e3594cc6a0f18354"
    (root / "old.py").write_bytes(old)
    (root / "new.py").write_bytes(new)
    (root / "seed.json").write_bytes((candidate / "tests/fixture-seed.json").read_bytes())
    os.environ.update(WORKBOARD_DATA=str(root / "data"), WORKBOARD_INITIAL_PASSWORD="FAKE upgrade password", WORKBOARD_ORIGIN="https://codex.danhkhai.io.vn", WORKBOARD_SECURE_COOKIE="1")
    before = load("old_fixture", root / "old.py")
    before.initialize()
    with before.db() as conn:
        state = json.loads(conn.execute("SELECT body FROM state WHERE id=1").fetchone()[0])
        state["tasks"][0]["nextStep"] = "SYNTHETIC existing user edit before upgrade"
        conn.execute("UPDATE state SET version=17,body=? WHERE id=1", (json.dumps(state),))
        conn.execute("INSERT INTO sessions VALUES('fake-session-digest', 9999999999)")
        conn.execute("INSERT INTO backups(created,version,body) VALUES(1,16,?)", (json.dumps(state),))
    def snapshot():
        with sqlite3.connect(root / "data/workboard.sqlite3") as conn:
            return {table: conn.execute("SELECT * FROM " + table).fetchall() for table in ["account", "state", "sessions", "backups", "attempts"]}
    rows = snapshot()
    os.environ.update(WORKBOARD_INITIAL_PASSWORD="FAKE different init password must be ignored", WORKBOARD_ORIGIN="http://127.0.0.1:5180", WORKBOARD_FRAME_ANCESTOR="https://codex.danhkhai.io.vn")
    # Deliberately incompatible seed: existing state must not be reset/imported.
    (root / "seed.json").write_text('{"unexpected":"must never be read"}')
    after = load("new_fixture", root / "new.py")
    after.initialize()
    assert before.DATA == after.DATA == root / "data"
    assert snapshot() == rows
    assert after.FRAME_ANCESTOR == "https://codex.danhkhai.io.vn"
    assert after.password_hash("FAKE upgrade password", rows["account"][0][1]) == rows["account"][0][2]
    assert (after.DATA / "workboard.sqlite3").stat().st_mode & 0o777 == 0o600
    print(json.dumps({"syntheticUpgradePreservesAccountStateVersionSessionsBackups": True, "seedNotReimported": True, "dataLocationPreserved": True, "productionDatabaseRead": False}))
