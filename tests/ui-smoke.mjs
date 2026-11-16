// Existing browser/API/SQLite scenarios, each with a separate process and fixture.
// Ollama is simulated. This does not constitute native Electron or real inference.
import { spawn } from 'node:child_process';
for (const suite of ['guest-ui', 'project-flows', 'workbench-ui']) {
  const child = spawn(process.execPath, [`tests/${suite}.mjs`], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
  // IPC lets Windows run teardown; child.kill() forcibly terminates on Windows.
  const forward = signal => {
    if (child.connected) child.send({ type: 'siaas-test-stop', signal }, () => {});
  };
  const onInt = () => forward('SIGINT'), onTerm = () => forward('SIGTERM');
  process.once('SIGINT', onInt); process.once('SIGTERM', onTerm);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => resolve(code ?? 1));
  });
  process.off('SIGINT', onInt); process.off('SIGTERM', onTerm);
  if (code !== 0) { process.exitCode = code; break; }
}
