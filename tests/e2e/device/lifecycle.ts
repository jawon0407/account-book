import { execFile, type ChildProcess } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

/**
 * @param child 이 실행기가 직접 만든 프로세스만 받는다. Windows에서는 살아 있는 자식 트리도 종료한다.
 * 종료 이벤트가 이미 발생했다면 기다리지 않는다. 정리 실패/시간 초과는 호출자에게 전달한다.
 */
export async function stopChild(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || hasExited(child)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onClose: () => void = () => {};
  const closed = new Promise<void>((resolve, reject) => {
    onClose = resolve;
    child.once('close', onClose);
    timer = setTimeout(() => reject(Error('DEVICE_CHILD_STOP_TIMEOUT')), 15_000);
  });
  // Register rejection handling before awaiting the OS tool.
  const terminate = async () => {
    if (process.platform === 'win32') {
      const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
      if (!systemRoot) throw Error('DEVICE_SYSTEM_ROOT_MISSING');
      try {
        await runFile(join(systemRoot, 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 10_000 });
      } catch (error) {
        if (!hasExited(child)) throw error;
      }
    } else if (!child.kill() && !hasExited(child)) {
      throw Error('DEVICE_CHILD_STOP_FAILED');
    }
  };
  try { await Promise.all([closed, terminate()]); }
  finally { clearTimeout(timer); child.off('close', onClose); }
}

/** @param failed 예상 밖 종료 여부. 모든 소유 자식의 정리와 DB 정리를 시도하고 실패 시 1을 반환한다. */
export async function stopStack(children: readonly ChildProcess[], cleanup: () => Promise<void>, failed: boolean): Promise<0 | 1> {
  let unsuccessful = failed;
  for (const child of [...children].reverse()) {
    try { await stopChild(child); } catch { unsuccessful = true; }
  }
  try { await cleanup(); } catch { unsuccessful = true; }
  return unsuccessful ? 1 : 0;
}
