import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { test } from 'node:test';
import { stopChild, stopStack } from './lifecycle.js';

test('Windows shutdown terminates an owned process and its descendant', { skip: process.platform !== 'win32', timeout: 20_000 }, async () => {
  const child = spawn(process.execPath, ['-e', `
    const {spawn}=require('node:child_process');
    const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log(worker.pid); setInterval(()=>{},1000);
  `], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const [chunk] = await once(child.stdout!, 'data');
  const workerPid = Number(String(chunk).trim());
  assert.ok(Number.isInteger(workerPid));
  try {
    await stopChild(child);
    assert.throws(() => process.kill(workerPid, 0));
  } finally {
    // Only these test-created processes; never target other Node instances.
    child.kill();
    try { process.kill(workerPid); } catch { /* already exited */ }
  }
});

test('already signal-terminated children do not leave shutdown waiting forever', { timeout: 5_000 }, async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true });
  await once(child, 'spawn');
  const exited = once(child, 'exit');
  child.kill(); await exited;
  assert.equal(child.signalCode, 'SIGTERM');
  await stopChild(child);
});

test('unexpected termination is failure even if cleanup succeeds', async () => {
  assert.equal(await stopStack([], async () => {}, true), 1);
});

test('cleanup failure is not a successful run', async () => {
  assert.equal(await stopStack([], async () => { throw Error('cleanup'); }, false), 1);
});

test('requested shutdown with complete cleanup succeeds', async () => {
  assert.equal(await stopStack([], async () => {}, false), 0);
});
