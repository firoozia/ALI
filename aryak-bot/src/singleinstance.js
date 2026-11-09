// Exactly one bot process may hold the WhatsApp session. Two processes on one session reply twice and fight over the login. A lock file in the auth folder names the process
// that holds it; a second process waits a little (the first may be stopping: a restart), then either takes over a lock whose process is gone, or gives up.

import fs from 'node:fs';
import path from 'node:path';

/** True when process [pid] is alive and is a node process (a reused pid of another program is a stale lock). */
export function holderAlive(pid, { alive = (p) => { try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; } }, cmdline = (p) => { try { return fs.readFileSync(`/proc/${p}/cmdline`, 'latin1'); } catch { return null; } } } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (!alive(pid)) return false;
  const cmd = cmdline(pid); // Linux only; where it cannot be read, a live pid counts as the holder
  return cmd === null ? true : /node/.test(cmd);
}

/**
 * Takes the lock [file]. Returns { ok: true, release } or { ok: false, holder } when another live process still holds it after [waitMs].
 * [pid]: this process (a test passes another number), [nap]: the wait between looks.
 */
const defaultNap = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function acquireSingleInstance(file, { pid = process.pid, waitMs = 30000, pollMs = 500, log = () => {}, alive, cmdline, nap } = {}) {
  const wait = nap || defaultNap;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      fs.writeFileSync(file, String(pid), { flag: 'wx', mode: 0o600 }); // created only if it does not exist
      return { ok: true, release: () => { try { if (fs.readFileSync(file, 'utf8').trim() === String(pid)) fs.rmSync(file); } catch { /* already gone */ } } };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    let holder = NaN;
    try { holder = Number(fs.readFileSync(file, 'utf8').trim()); } catch { /* removed meanwhile: try again */ }
    if (holder === pid) return { ok: true, release: () => { try { fs.rmSync(file); } catch { /* gone */ } } };
    if (!holderAlive(holder, { alive, cmdline })) { log(`single instance: the lock of process ${holder} is stale, taken over`); try { fs.rmSync(file); } catch { /* another process took it */ } continue; }
    if (Date.now() >= deadline) return { ok: false, holder };
    await wait(pollMs);
  }
}
