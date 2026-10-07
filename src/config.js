// All environment-specific settings live here, so moving from the Stage 1 test
// computer to a cloud server only changes environment variables, never code.
const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '127.0.0.1',
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  // 'local' keeps documents in DATA_DIR/files; 's3' is for Stage 2 (see storage.js).
  storage: process.env.STORAGE || 'local',
  s3: {
    bucket: process.env.S3_BUCKET || '',
    region: process.env.S3_REGION || 'ap-south-1',
  },
  // Stage 1 never sends anything: every message goes to the in-app outbox.
  stage: process.env.LIMS_STAGE || 'test',
  live: process.env.LIMS_STAGE === 'live',
  // Behind https (the live server), sign-in cookies are sent over https only.
  secureCookies: process.env.SECURE_COOKIES === '1' || process.env.LIMS_STAGE === 'live',
  timeZone: 'Asia/Kolkata',
  sessionHours: 12,
};
