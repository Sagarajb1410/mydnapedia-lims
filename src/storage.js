// Document storage behind one small interface: put / get / exists.
// Stage 1 stores files in DATA_DIR/files. When the AWS bucket is ready, an S3
// adapter with the same three functions is added here and STORAGE=s3 is set;
// no other code changes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

function localAdapter(baseDir) {
  const safe = (key) => {
    if (!/^[A-Za-z0-9/_.-]+$/.test(key) || key.includes('..')) throw new Error('Bad file key');
    return path.join(baseDir, key);
  };
  return {
    put(key, buffer) {
      const file = safe(key);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
      return { key, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
    },
    get(key) {
      return fs.readFileSync(safe(key));
    },
    exists(key) {
      return fs.existsSync(safe(key));
    },
  };
}

function create() {
  if (config.storage === 'local') return localAdapter(path.join(config.dataDir, 'files'));
  if (config.storage === 's3') throw new Error('S3 storage is planned for Stage 2 and is not configured yet.');
  throw new Error(`Unknown STORAGE setting "${config.storage}".`);
}

module.exports = { create, localAdapter };
