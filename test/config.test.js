const test = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Reads config.secureCookies in a fresh process with the given environment.
function secure(env) {
  const file = JSON.stringify(path.join(__dirname, '..', 'src', 'config.js'));
  const out = execFileSync(process.execPath, ['-p', `require(${file}).secureCookies`], {
    env: { PATH: process.env.PATH, ...env },
  });
  return out.toString().trim() === 'true';
}

test('live LIMS sends sign-in cookies over https only, unless it runs on the office network by IP', () => {
  assert.equal(secure({}), false);
  assert.equal(secure({ LIMS_STAGE: 'live' }), true);
  assert.equal(secure({ SECURE_COOKIES: '1' }), true);
  assert.equal(secure({ LIMS_STAGE: 'live', SECURE_COOKIES: '0' }), false);
});
