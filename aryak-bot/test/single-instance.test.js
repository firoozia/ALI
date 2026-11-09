import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireSingleInstance, holderAlive } from '../src/singleinstance.js';

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lock-'));
const noWait = { nap: async () => {} };

test('one process holds the session: the first takes the lock, a second one (a live holder) gives up after its wait, the lock goes when the holder leaves', async () => {
  const file = path.join(dir(), 'bot.lock');
  const first = await acquireSingleInstance(file, { pid: 4001, alive: () => true, cmdline: () => 'node\0--env-file=.env\0src/index.js', ...noWait });
  assert.equal(first.ok, true); assert.equal(fs.readFileSync(file, 'utf8'), '4001');
  let looks = 0;
  const second = await acquireSingleInstance(file, { pid: 4002, waitMs: 50, pollMs: 1, alive: () => true, cmdline: () => 'node\0src/index.js', nap: async () => { looks += 1; await new Promise((r) => setTimeout(r, 2)); } });
  assert.deepEqual([second.ok, second.holder], [false, 4001]); assert.ok(looks > 1); // it looked more than once: a restart's old process gets time to stop
  assert.equal(fs.readFileSync(file, 'utf8'), '4001'); // the holder's lock is untouched
  first.release(); assert.equal(fs.existsSync(file), false);
  const third = await acquireSingleInstance(file, { pid: 4003, ...noWait }); assert.equal(third.ok, true); third.release();
});

test('a restart: the second process waits for the first to stop, then takes over; a dead or foreign holder is a stale lock', async () => {
  const file = path.join(dir(), 'bot.lock');
  fs.writeFileSync(file, '5001');
  let alive = true; let n = 0;
  const got = await acquireSingleInstance(file, { pid: 5002, waitMs: 5000, alive: () => alive, cmdline: () => 'node\0src/index.js', nap: async () => { n += 1; if (n === 3) { alive = false; } } }); // the old process stops during the wait
  assert.equal(got.ok, true); assert.ok(n >= 3); assert.equal(fs.readFileSync(file, 'utf8'), '5002');
  const logs = [];
  const file2 = path.join(dir(), 'bot.lock'); fs.writeFileSync(file2, '6001');
  const stale = await acquireSingleInstance(file2, { pid: 6002, alive: () => true, cmdline: () => 'bash\0-c\0sleep', log: (m) => logs.push(m), ...noWait }); // the pid now belongs to another program
  assert.equal(stale.ok, true); assert.match(logs[0], /lock of process 6001 is stale/);
  const file3 = path.join(dir(), 'bot.lock'); fs.writeFileSync(file3, 'garbage');
  assert.equal((await acquireSingleInstance(file3, { pid: 7001, ...noWait })).ok, true); // a damaged lock file is stale
  assert.equal(holderAlive(0), false); assert.equal(holderAlive(NaN), false); assert.equal(holderAlive(process.pid, { cmdline: () => null }), true); // where the command line cannot be read, a live pid is the holder
  const own = path.join(dir(), 'bot.lock'); const mine = await acquireSingleInstance(own, { pid: 8001, ...noWait });
  fs.writeFileSync(own, '8002'); mine.release(); assert.equal(fs.readFileSync(own, 'utf8'), '8002'); // never removes another process's lock
});

test('the wiring: the lock is taken before anything connects, in the auth folder; a loser stops; the signals release it', () => {
  const index = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'index.js'), 'utf8');
  const at = index.indexOf("acquireSingleInstance(path.join(config.authDir, 'bot.lock')");
  assert.ok(at > 0 && at < index.indexOf('makeWASocket({') && at < index.indexOf('new Tracker('));
  assert.match(index, /holds the WhatsApp session; this one stops so the two do not answer twice`\); process\.exit\(1\);/);
  assert.match(index, /process\.on\('exit', free\);/); assert.match(index, /for \(const sig of \['SIGTERM', 'SIGINT'\]\)/);
  assert.match(index, /void migrateStoredPayments\(tracker\.events\)/); // the old payment rows are re-read soon after start, not only on a report
});
