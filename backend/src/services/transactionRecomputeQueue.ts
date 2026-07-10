import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let recomputeRunning = false;
let recomputePending = false;

function runRecompute(trigger: string): string | null {
  recomputeRunning = true;

  const serviceDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(serviceDir, '..', '..');
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  let child;
  try {
    child = spawn(npmCommand, ['run', 'data:recalculate:transaction-calculations'], {
      cwd: backendRoot,
      stdio: 'ignore',
    });
  } catch (error) {
    // Some Windows environments throw EINVAL on direct npm.cmd spawn.
    // Fallback through cmd.exe so transaction updates are not blocked by recompute startup.
    if (process.platform === 'win32') {
      try {
        child = spawn('cmd.exe', ['/d', '/s', '/c', 'npm.cmd run data:recalculate:transaction-calculations'], {
          cwd: backendRoot,
          stdio: 'ignore',
        });
      } catch (fallbackError) {
        console.error(
          '[recompute-queue] failed to start recompute (fallback):',
          fallbackError instanceof Error ? fallbackError.message : fallbackError
        );
        recomputeRunning = false;
        return 'Saved, but background transaction recalculation could not be started. Please run recalculation manually if needed.';
      }
    } else {
      console.error(
        '[recompute-queue] failed to start recompute:',
        error instanceof Error ? error.message : error
      );
      recomputeRunning = false;
      return 'Saved, but background transaction recalculation could not be started. Please run recalculation manually if needed.';
    }
  }

  child.on('error', (error) => {
    console.error('[recompute-queue] failed to start recompute:', error instanceof Error ? error.message : error);
    recomputeRunning = false;
  });

  child.on('exit', (code) => {
    if (code !== 0) {
      console.error(`[recompute-queue] recompute exited with code ${String(code)} (trigger: ${trigger})`);
    }

    recomputeRunning = false;
    if (recomputePending) {
      recomputePending = false;
      runRecompute('queued');
    }
  });

  return null;
}

export function scheduleTransactionAgentRecompute(trigger: string): string | null {
  if (recomputeRunning) {
    recomputePending = true;
    return null;
  }

  return runRecompute(trigger);
}
