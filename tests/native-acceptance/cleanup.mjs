// Deterministic cleanup orchestration. Callbacks own filesystem/service operations.
import { Blocked } from './safety.mjs';
export const errorCode = error => /^[A-Z0-9_]{1,100}$(?![\s\S])/.test(error?.message || '') ? error.message : 'NATIVE_ASSERTION_FAILED';
export async function runScenario(scenarios, id, body, persist = () => {}) {
  const row = scenarios.find(item => item.id === id);
  try { await body(); row.status = 'PASS'; row.reason = 'ASSERTIONS_COMPLETED'; }
  catch (error) { row.status = error instanceof Blocked ? 'BLOCKED' : 'FAIL'; row.reason = errorCode(error); throw error; }
  finally {
    try { persist(); }
    catch (error) { row.status = 'FAIL'; row.reason = 'RECEIPT_PERSISTENCE_FAILED'; throw error; }
  }
}
const cleanups = new WeakMap();
export function cleanupOwned(options) {
  if (!cleanups.has(options.report)) cleanups.set(options.report, performCleanup(options));
  return cleanups.get(options.report);
}
async function performCleanup({ report, root, audit, dispose = async () => {}, remove = async () => {}, closeServices = async () => {} }) {
  if (!root) return;
  const row = report.scenarios.find(item => item.id === 'cleanup');
  let removed = false;
  try {
    if (!audit) throw new Blocked('PROCESS_AUDIT_NOT_INITIALIZED');
    await audit.finish(); // Shared, idempotent termination and command-drain barrier.
    await dispose();
    await remove(); removed = true;
    await closeServices();
    row.status = 'PASS'; row.reason = 'IDENTITIES_AND_REMOVAL_CHECKED';
  } catch (error) {
    row.status = 'BLOCKED'; row.reason = errorCode(error);
    // Preserve the primary scenario failure; cleanup evidence has its own cause.
    if (report.status === 'PASS') { report.status = 'BLOCKED'; report.reason = row.reason; }
    try { await closeServices(); } catch { /* The cleanup row stays blocked. */ }
  }
  report.cleanup.push({ path: root, removed, reason: row.reason });
}
