#!/usr/bin/env python3
"""NON-PRODUCTION prerequisite probes; no elevated privileges or security changes."""
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from spike import clean_env


def main():
    if sys.platform != "linux":
        print(json.dumps({"classification": "NOT RUN", "reason": "Linux-only probe; native test backend required"}))
        return
    with tempfile.TemporaryDirectory(prefix="siaas-containment-probe-") as temp:
        marker = Path(temp) / "child-ran"
        child = [sys.executable, "-c", "from pathlib import Path;import sys;Path(sys.argv[1]).write_text('fixture')", str(marker)]
        candidates = [
            ["unshare", "--user", "--map-root-user", "--mount", "--net", "--pid", "--fork", *child],
            ["bwrap", "--unshare-user", "--unshare-net", "--ro-bind", "/", "/", "--bind", temp, temp, "--", *child],
            ["systemd-run", "--user", "--scope", "--quiet", *child],
        ]
        env = clean_env()
        for key in ["DBUS_SESSION_BUS_ADDRESS", "XDG_RUNTIME_DIR"]:
            if key in os.environ: env[key] = os.environ[key]
        for args in candidates:
            marker.unlink(missing_ok=True)
            if not shutil.which(args[0]):
                print(json.dumps({"mechanism": args[0], "classification": "BLOCKED", "reason": "tool absent"}))
                continue
            try:
                r = subprocess.run(args, env=env, capture_output=True, text=True, timeout=8)
                print(json.dumps({"mechanism": args[0], "exit": r.returncode,
                    "child_ran": marker.exists(), "classification": "BLOCKED" if r.returncode else "VERIFIED",
                    "scope": "prerequisite invocation only, not containment acceptance",
                    "diagnostic": r.stderr.strip()[:1200]}))
            except subprocess.TimeoutExpired:
                print(json.dumps({"mechanism": args[0], "classification": "BLOCKED", "reason": "probe timeout"}))
        print(json.dumps({"os":platform.system(), "arch":platform.machine(), "uid":os.getuid(),
            "cgroup_writable":os.access('/sys/fs/cgroup',os.W_OK),
            "adapter_build_authorized":False,
            "reason":"No accepted full containment backend; no real build/installer executed"}))

if __name__ == '__main__': main()
