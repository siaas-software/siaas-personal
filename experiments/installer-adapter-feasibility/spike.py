#!/usr/bin/env python3
"""NON-PRODUCTION Linux feasibility probes. No Personal code imported or executed.
All writable state is TemporaryDirectory-owned; no real installers/profiles/launchers.
Run: python experiments/installer-adapter-feasibility/spike.py
"""
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import select
import socket
import subprocess
import sys
import tempfile
import unittest

SELF = str(Path(__file__).resolve())

def clean_env(cache=None):
    # Construct, do not filter inherited secrets; HOME is neither read nor overridden.
    env = {"PATH": str(Path(shutil.which("node") or sys.executable).parent) + os.pathsep + os.defpath,
           "LANG": "C.UTF-8"}
    if cache:
        cache.mkdir(parents=True, exist_ok=True)
        user_config, global_config = cache / "user.npmrc", cache / "global.npmrc"
        user_config.write_text(""); global_config.write_text("")
        env.update(npm_config_cache=str(cache), npm_config_userconfig=str(user_config),
                   npm_config_globalconfig=str(global_config), npm_config_update_notifier="false")
    return env

def ready_line(stream):
    if not select.select([stream], [], [], 5)[0]:
        raise TimeoutError("fixture readiness timeout")
    return stream.readline().strip()

def sync_dir(p):
    fd = os.open(p, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)

def replace(p, data):
    tmp = p.with_name(p.name + ".new")
    with tmp.open("wb") as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, p); sync_dir(p.parent)

def record(root, state):
    p = root / "journal"
    prior = p.read_bytes() if p.exists() else b""
    entry = {"state": state, "previous": hashlib.sha256(prior).hexdigest()}
    with p.open("ab") as f:
        f.write(json.dumps(entry).encode() + b"\n"); f.flush(); os.fsync(f.fileno())
    sync_dir(root)

def read_journal(root):
    prior = b""; states = []
    for line in (root / "journal").read_bytes().splitlines(keepends=True):
        if not line.endswith(b"\n"): raise ValueError("truncated journal: refuse")
        x = json.loads(line)
        if x["previous"] != hashlib.sha256(prior).hexdigest(): raise ValueError("chain mismatch")
        states.append(x["state"]); prior += line
    return states

def setup(root, launch):
    root.mkdir(exist_ok=True); launch.mkdir(exist_ok=True)
    replace(root / "current", b"old"); replace(launch / "launcher", b"old")
    replace(root / "revision", b"0"); replace(root / "built", b"verified toy bytes")
    record(root, "prepared")

def activate(root, launch, crash):
    # This intentionally small roll-forward model is NOT the normative adapter.
    def boundary(name):
        if name == crash: os.kill(os.getpid(), signal.SIGKILL)
    record(root, "commit-intent"); boundary("commit-intent")
    os.replace(root / "built", root / "generation"); sync_dir(root); boundary("generation")
    record(root, "committed"); boundary("committed")
    replace(root / "gate", b"blocked"); record(root, "activate-intent"); boundary("gate")
    replace(launch / "launcher", b"new"); boundary("launcher")
    replace(root / "current", b"new"); boundary("pointer")
    replace(root / "revision", b"1"); record(root, "activated"); boundary("activated")
    (root / "gate").unlink(); sync_dir(root); boundary("gate-release")
    replace(root / "receipt", b"activated"); boundary("receipt")

def recover(root, launch):
    states = read_journal(root)
    if "commit-intent" not in states: raise ValueError("no accepted intent")
    if not (root / "generation").exists():
        os.replace(root / "built", root / "generation"); sync_dir(root)
    if (root / "generation").read_bytes() != b"verified toy bytes": raise ValueError("integrity")
    replace(root / "gate", b"blocked")
    replace(launch / "launcher", b"new"); replace(root / "current", b"new")
    replace(root / "revision", b"1")
    if states[-1] != "activated": record(root, "activated")
    (root / "gate").unlink(); sync_dir(root)
    replace(root / "receipt", b"activated")

def worker(args):
    action, root_arg, *extra = args; root = Path(root_arg)
    if action == "activate": activate(root, Path(extra[0]), extra[1])
    elif action == "lock":
        with (root / "lock").open("a") as f:
            try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: return 4
            print("locked", flush=True); sys.stdin.read(1)
    elif action == "cas":
        with (root / "lock").open("a") as f:
            fcntl.flock(f, fcntl.LOCK_EX)
            if (root / "revision").read_bytes() != b"0": return 4
            replace(root / "revision", b"1"); return 0
    return 0

@unittest.skipUnless(sys.platform == "linux", "Linux-only prototype; native others NOT RUN")
class Spike(unittest.TestCase):
    def test_01_environment_allowlist(self):
        code = "import os; assert set(os.environ)<= {'PATH','LANG','LC_CTYPE'}; print('allowlist-only')"
        result = subprocess.run([sys.executable, "-c", code], env=clean_env(), capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_02_cooperative_group_cancel_and_escape(self):
        # Controlled parent traps group SIGTERM, reports escaped child, then cleans it.
        code = '''import subprocess,sys,signal,os
child=subprocess.Popen([sys.executable,'-c','import time; time.sleep(20)'],start_new_session=True)
def stop(*_):
 print('escaped-alive='+str(child.poll() is None),flush=True)
 child.terminate(); child.wait(timeout=5); sys.exit(0)
signal.signal(signal.SIGTERM,stop)
print('ready',flush=True)
signal.pause()
'''
        sibling = subprocess.Popen([sys.executable, "-c", "import time;time.sleep(20)"], env=clean_env())
        p = subprocess.Popen([sys.executable, "-c", code], start_new_session=True, env=clean_env(), stdout=subprocess.PIPE, text=True)
        try:
            self.assertEqual(ready_line(p.stdout), "ready")
            os.killpg(p.pid, signal.SIGTERM)
            output, _ = p.communicate(timeout=8)
            self.assertIn("escaped-alive=True", output)  # process group is NOT containment
            self.assertEqual(p.returncode, 0); self.assertIsNone(sibling.poll())
        finally:
            if p.poll() is None: os.killpg(p.pid, signal.SIGKILL); p.wait()
            sibling.terminate(); sibling.wait(timeout=5)

    def test_03_npm_lifecycle_environment_is_not_containment(self):
        npm = shutil.which("npm")
        if not npm: self.skipTest("npm unavailable")
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            root = Path(t); tx = root / "transaction"; tx.mkdir()
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0)); listener.listen(); listener.settimeout(5)
                port = listener.getsockname()[1]
                # Only a loopback connection and sibling TEMP files, no actual GUI.
                payload = '''const fs=require('fs'),cp=require('child_process'),net=require('net');
fs.writeFileSync('../outside-transaction','fixture');
cp.execFileSync(process.execPath,['-e',"require('fs').writeFileSync('../mock-app-started','fixture')"]);
const s=net.connect(PORT,'127.0.0.1',()=>s.end('fixture',()=>s.destroy()));
s.on('error',()=>process.exit(3));
'''.replace("PORT", str(port))
                (tx / "payload.cjs").write_text(payload)
                (tx / "package.json").write_text(json.dumps({"name":"spike-fixture","version":"1.0.0","scripts":{"prepare":"node payload.cjs"}}))
                (tx / "package-lock.json").write_text(json.dumps({"name":"spike-fixture","version":"1.0.0","lockfileVersion":3,"packages":{"":{"name":"spike-fixture","version":"1.0.0"}}}))
                process = subprocess.Popen([npm, "ci", "--offline", "--no-audit", "--no-fund"], cwd=tx, env=clean_env(root / "cache"), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True)
                try:
                    _, errors = process.communicate(timeout=20)
                finally:
                    if process.poll() is None:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.communicate(timeout=5)
                self.assertEqual(process.returncode, 0, errors)
                conn, _ = listener.accept()
                with conn: self.assertEqual(conn.recv(64), b"fixture")
                self.assertTrue((root / "outside-transaction").exists())
                self.assertTrue((root / "mock-app-started").exists())

    def test_04_flock_exclusion_and_sigkill_release(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            p = subprocess.Popen([sys.executable, SELF, "worker", "lock", t], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=clean_env())
            try:
                self.assertEqual(ready_line(p.stdout), "locked")
                r = subprocess.run([sys.executable, SELF, "worker", "lock", t], input="x", capture_output=True, text=True, env=clean_env(), timeout=5)
                self.assertEqual(r.returncode, 4)
                p.kill(); p.wait(timeout=5)
                r = subprocess.run([sys.executable, SELF, "worker", "lock", t], input="x", capture_output=True, text=True, env=clean_env(), timeout=5)
                self.assertEqual(r.returncode, 0); self.assertTrue((Path(t) / "lock").exists())
            finally:
                if p.poll() is None: p.kill(); p.wait()
                p.stdin.close(); p.stdout.close()

    def test_05_two_process_generation_cas(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            replace(Path(t) / "revision", b"0")
            children = [subprocess.Popen([sys.executable, SELF, "worker", "cas", t], env=clean_env()) for _ in range(2)]
            self.assertEqual(sorted(p.wait(timeout=5) for p in children), [0, 4])
            self.assertEqual((Path(t) / "revision").read_bytes(), b"1")

    def test_06_sigkill_at_nine_activation_boundaries(self):
        boundaries = ["commit-intent", "generation", "committed", "gate", "launcher", "pointer", "activated", "gate-release", "receipt"]
        for point in boundaries:
            with self.subTest(boundary=point), tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
                root = Path(t) / "root"; launch = Path(t) / "external-launcher"
                setup(root, launch)
                r = subprocess.run([sys.executable, SELF, "worker", "activate", str(root), str(launch), point], env=clean_env(), timeout=5)
                self.assertEqual(r.returncode, -signal.SIGKILL)
                if point == "launcher":
                    self.assertEqual((root / "current").read_bytes(), b"old")
                    self.assertEqual((launch / "launcher").read_bytes(), b"new")
                    self.assertTrue((root / "gate").exists())  # visible mixed state, not atomic
                recover(root, launch); recover(root, launch)
                self.assertEqual((root / "current").read_bytes(), b"new")
                self.assertEqual((launch / "launcher").read_bytes(), b"new")
                self.assertEqual((root / "revision").read_bytes(), b"1")
                self.assertEqual((root / "receipt").read_bytes(), b"activated")
                self.assertFalse((root / "gate").exists())

    def test_07_receipt_failure_preserves_activation(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            root = Path(t) / "root"; launch = Path(t) / "launch"; setup(root, launch)
            (root / "receipt").mkdir()  # deterministic EISDIR, no ACL weakening
            with self.assertRaises(OSError): activate(root, launch, "none")
            self.assertEqual(read_journal(root)[-1], "activated")
            self.assertEqual((root / "current").read_bytes(), b"new")
            (root / "receipt").rmdir(); recover(root, launch)
            self.assertEqual((root / "receipt").read_bytes(), b"activated")

    def test_08_corrupt_and_truncated_journal_fail_closed(self):
        for damaged in [b'{"unfinished":', b'{"state":"activated","previous":"wrong"}\n']:
            with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
                root = Path(t) / "root"; launch = Path(t) / "launch"; setup(root, launch)
                with (root / "journal").open("ab") as f: f.write(damaged)
                before = (root / "current").read_bytes()
                with self.assertRaises(ValueError): recover(root, launch)
                self.assertEqual((root / "current").read_bytes(), before)

    def test_09_handle_relative_nofollow(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            root = Path(t); (root / "owned").mkdir(); (root / "sibling").mkdir()
            (root / "link").symlink_to(root / "sibling", target_is_directory=True)
            fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaises(OSError): os.open("link", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                child = os.open("owned", os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                try:
                    (root / "owned").rename(root / "retained")
                    (root / "owned").symlink_to(root / "sibling", target_is_directory=True)
                    out = os.open("probe", os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=child)
                    os.close(out)
                    self.assertTrue((root / "retained/probe").exists())
                    self.assertFalse((root / "sibling/probe").exists())
                finally: os.close(child)
            finally: os.close(fd)

    def test_10_cross_volume_launcher(self):
        # Both are newly created temporary directories. No actual workspace files touched.
        with tempfile.TemporaryDirectory(prefix="siaas-spike-", dir="/tmp") as a, tempfile.TemporaryDirectory(prefix="siaas-spike-", dir="/workspace") as b:
            root, launch = Path(a), Path(b)
            if root.stat().st_dev == launch.stat().st_dev: self.skipTest("second writable volume unavailable")
            setup(root, launch)
            with self.assertRaises(OSError) as e: os.replace(root / "built", launch / "cross-device")
            self.assertEqual(e.exception.errno, errno.EXDEV)
            r = subprocess.run([sys.executable, SELF, "worker", "activate", str(root), str(launch), "launcher"], env=clean_env(), timeout=5)
            self.assertEqual(r.returncode, -signal.SIGKILL)
            recover(root, launch)
            self.assertEqual((root / "current").read_bytes(), (launch / "launcher").read_bytes())

    def test_11_installed_generation_corruption_rejected(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            root = Path(t) / "root"; launch = Path(t) / "launch"; setup(root, launch)
            record(root, "commit-intent"); os.replace(root / "built", root / "generation")
            (root / "generation").write_bytes(b"corrupt")
            with self.assertRaises(ValueError): recover(root, launch)
            self.assertEqual((root / "current").read_bytes(), b"old")

    def test_12_atomic_single_file_replace_readers(self):
        with tempfile.TemporaryDirectory(prefix="siaas-spike-") as t:
            root = Path(t); replace(root / "selected", b"a" * 8192)
            code = """import pathlib,sys,time
p=pathlib.Path(sys.argv[1]);print('ready',flush=True)
end=time.monotonic()+5
count=0
while not (p/'stop').exists() and time.monotonic()<end:
 data=(p/'selected').read_bytes()
 if data not in (b'a'*8192,b'b'*8192):sys.exit(2)
 count+=1
print(count,flush=True)
"""
            reader = subprocess.Popen([sys.executable, "-c", code, t], stdout=subprocess.PIPE, text=True, env=clean_env())
            try:
                self.assertEqual(ready_line(reader.stdout), "ready")
                for i in range(50): replace(root / "selected", (b"a" if i % 2 else b"b") * 8192)
                (root / "stop").touch()
                output, _ = reader.communicate(timeout=7)
                self.assertEqual(reader.returncode, 0)
                self.assertGreater(int(output.strip()), 0)
            finally:
                if reader.poll() is None: reader.kill(); reader.wait()
                reader.stdout.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "worker": sys.exit(worker(sys.argv[2:]))
    print(json.dumps({"os": platform.system(), "arch": platform.machine(), "kernel": platform.release(), "uid": os.getuid(), "scope": "non-production fixtures only"}), flush=True)
    unittest.main(verbosity=2)
