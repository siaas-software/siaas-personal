// Test-only workaround for Playwright 1.63.0's early Electron exit race.
// Keep every original await/rethrow/kill: only observe sibling rejection promises
// immediately, before waiting for the Node debugger endpoint. No disk patch or
// process-level rejection handler. Remove when a verified upstream fix is pinned.
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let electron;

export function getElectron() {
  if (electron) return electron;
  const version = require('playwright-core/package.json').version;
  if (version !== '1.63.0') throw new Error(`Revalidate the Electron launch workaround for Playwright ${version}`);
  const bundle = pathToFileURL(require.resolve('playwright-core/lib/coreBundle')).href;
  const anchor = '        const debuggerDisconnectPromise = waitForLine(progress2, launchedProcess, /Waiting for the debugger to disconnect\\.\\.\\./);';
  let applied = false;
  const hook = registerHooks({
    load(url, context, nextLoad) {
      const result = nextLoad(url, context);
      if (url !== bundle) return result;
      const source = String(result.source);
      if (source.split(anchor).length !== 2) throw new Error('Playwright Electron launch source changed; revalidate the workaround');
      applied = true;
      return { ...result, source: source.replace(anchor, anchor + '\n        void Promise.allSettled([waitForXserverError, chromeMatchPromise, debuggerDisconnectPromise]);') };
    },
  });
  try {
    const playwright = require('playwright');
    if (!applied) throw new Error('Load the Electron test adapter before importing Playwright in this process');
    electron = playwright._electron;
    return electron;
  } finally { hook.deregister(); }
}
