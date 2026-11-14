// First-party Linux gate. Never signal any process; incomplete observations fail.
import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs';
export function requireStopped(root) {
  for (const pid of readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    if (Number(pid) === process.pid) continue;
    try {
      if (statSync(`/proc/${pid}`).uid !== process.getuid()) continue;
      const status = readFileSync(`/proc/${pid}/stat`, 'utf8');
      if (status.slice(status.lastIndexOf(')')+2).startsWith('Z')) continue;
      const exe = readlinkSync(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
      const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      if (exe.startsWith(root+'/') || argv.includes(root+'/profile')) throw Error('Owned application or operation is running; close it and retry.');
    } catch (e) {
      if (['ENOENT','ESRCH'].includes(e.code)) continue;
      throw e;
    }
  }
}
