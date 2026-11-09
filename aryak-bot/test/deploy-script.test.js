import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const file = path.join(import.meta.dirname, '..', 'deploy', 'gcp-startup.sh');
const sh = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

test('the service is never enabled at boot: only the startup script starts it, after the update; the disable is safe on every boot', () => {
  assert.doesNotMatch(sh, /systemctl enable/); // no start by the system before the code is updated
  const disables = sh.match(/systemctl disable aryak-bot >\/dev\/null 2>&1 \|\| true/g) || [];
  assert.equal(disables.length, 2); // at the top (a unit enabled by an older version) and again before the start; both idempotent
  assert.ok(sh.indexOf('systemctl disable aryak-bot') < sh.indexOf('git -C /opt/ALI fetch')); // the old early start is switched off first
  assert.ok(sh.lastIndexOf('systemctl disable aryak-bot') < sh.indexOf('systemctl restart aryak-bot') && sh.indexOf('git -C /opt/ALI fetch') < sh.indexOf('systemctl restart aryak-bot'));
  assert.match(sh, /service aryak-bot started by the startup script/); // a clear line when the script starts it
});

test('the bot never stays down because of the update: a failed fetch, reset, npm or metadata read is logged and the service is still started', () => {
  assert.doesNotMatch(sh, /^set -[a-z]*e/m); // no «set -e»: a failing step does not end the script
  assert.match(sh, /UPDATE FAILED \(git fetch or reset\): the bot starts with the code already on disk/);
  assert.match(sh, /UPDATE FAILED \(npm ci\): trying npm install once, then starting anyway/); assert.match(sh, /UPDATE FAILED \(npm install\)/);
  assert.match(sh, /timeout 180 git -C \/opt\/ALI fetch --depth 1 origin "\$BRANCH" && git -C \/opt\/ALI reset --hard FETCH_HEAD/); // «HEAD is now at <sha>» is git's own line from the reset
  assert.match(sh, /timeout 600 npm ci --omit=dev/);
  // the packages are installed only when the lock file changed: npm ci empties node_modules first
  assert.match(sh, /packages unchanged/); assert.match(sh, /sha256sum package-lock\.json/);
  // the settings are written aside and used only when the metadata was really read
  assert.match(sh, /: > \.env\.new/); assert.doesNotMatch(sh, /^: > \.env$/m);
  assert.match(sh, /if grep -q '\^ANTHROPIC_API_KEY=' \.env\.new; then\n  mv -f \.env\.new \.env/); assert.match(sh, /METADATA NOT READ: the settings of the last start are kept/);
  // the start comes after all of it, and its own failure is logged
  assert.ok(sh.indexOf('systemctl restart aryak-bot') > sh.indexOf('METADATA NOT READ') && sh.indexOf('systemctl restart aryak-bot') > sh.indexOf('UPDATE FAILED (npm install)'));
  assert.match(sh, /START FAILED: systemctl restart aryak-bot returned an error/);
  assert.match(sh, /AUTH_DIR=\/opt\/aryak-auth/); assert.match(sh, /EVENING_REPORT_HOUR EVENING_REPORT_TO/); // the settings the bot reads are still all passed on
});

test('the script is valid shell (checked with bash when it is available)', (t) => {
  const r = spawnSync('bash', ['-n', file], { encoding: 'utf8' });
  if (r.error) { t.skip('bash is not available here'); return; }
  assert.equal(r.status, 0, r.stderr);
});
