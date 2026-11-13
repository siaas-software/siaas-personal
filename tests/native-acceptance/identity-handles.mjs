// Algorithm/bridge contract only: no native binding, syscalls, spawning or PID kill.
// Tickets must originate from an authenticated owned-spawn broker. A census row,
// executable path, caller-supplied PID or this JS validation is not that authority.
import { Blocked } from './safety.mjs';
const denied = code => { throw new Blocked(code); };
function identity(value, platform) {
  if (!value || !Number.isSafeInteger(value.pid) || value.pid <= 1 || value.platform !== platform ||
      typeof value.birth !== 'string' || value.birth.length > 30 || !/^[0-9]+$(?![\s\S])/.test(value.birth) ||
      typeof value.scope !== 'string' || !value.scope || value.scope.length > 200)
    denied('HANDLE_IDENTITY_INVALID');
  return Object.freeze({ platform, pid: value.pid, birth: value.birth, scope: value.scope });
}
const equal = (a, b) => ['platform', 'pid', 'birth', 'scope'].every(k => a[k] === b[k]);
export function identityController(platform, bridge) {
  if (!['linux', 'win32'].includes(platform)) denied('IDENTITY_BACKEND_UNJUSTIFIED');
  const records = new WeakMap(), claimedHandles = new WeakSet();
  return {
    async capture(ticket) {
      // claimOwned must reject unknown tickets, foreign ownership and census-only
      // discovery; native broker retains a handle acquired before PID reuse.
      const claim = await bridge.claimOwned(ticket);
      let accepted = false, reserved = false;
      try {
        if (!claim || !claim.handle || typeof claim.handle !== 'object') denied('OWNERSHIP_NOT_ESTABLISHED');
        if (claimedHandles.has(claim.handle)) denied('HANDLE_ALREADY_CLAIMED');
        // Reserve before the first awaited inspection: concurrent capture must
        // not authorize two tokens or close another capture's in-flight handle.
        claimedHandles.add(claim.handle); reserved = true;
        if (claim.authority !== 'owned-spawn') denied('OWNERSHIP_NOT_ESTABLISHED');
        const expected = identity(claim.identity, platform);
        const current = await bridge.inspect(claim.handle);
        if (!equal(expected, identity(current.identity, platform))) denied('HANDLE_IDENTITY_CHANGED');
        if (!['live', 'exited', 'zombie'].includes(current.state)) denied('HANDLE_STATE_UNKNOWN');
        const token = Object.freeze({});
        records.set(token, { handle: claim.handle, identity: expected, operation: null });
        accepted = true; return token;
      } finally { if (!accepted && reserved) await bridge.close(claim.handle); }
    },
    terminate(token, timeoutMs = 4000) {
      const record = token && typeof token === 'object' && records.get(token);
      if (!record) return Promise.reject(new Blocked('UNKNOWN_OWNERSHIP_TOKEN'));
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 10000)
        return Promise.reject(new Blocked('INVALID_TERMINATION_DEADLINE'));
      if (!record.operation) record.operation = (async () => {
        try {
          const current = await bridge.inspect(record.handle);
          if (!equal(record.identity, identity(current.identity, platform))) denied('HANDLE_IDENTITY_CHANGED');
          if (!['live', 'exited', 'zombie'].includes(current.state)) denied('HANDLE_STATE_UNKNOWN');
          if (current.state === 'live') await bridge.requestTermination(record.handle);
          // Native implementation must use bounded handle-based wait/poll. A
          // successful signal request is NOT evidence of process exit or reaping.
          if (await bridge.waitExit(record.handle, timeoutMs) !== true) denied('HANDLE_EXIT_UNVERIFIED');
          return { state: 'EXIT_OBSERVED', reaping: 'UNVERIFIED', identity: record.identity };
        } finally { await bridge.close(record.handle); }
      })();
      return record.operation;
    },
  };
}
