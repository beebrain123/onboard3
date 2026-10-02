// One-time cleanup for recent failed ZeroAuthDAO relays.
// Run only after reviewing the exact matches printed by --dry-run.
require('dotenv').config();
const mongoose = require('mongoose');
const ThirdPartySubmission = require('../models/ThirdPartySubmission');
const User = require('../models/User');

const cutoff = new Date(process.env.ZAD_CLEANUP_SINCE || '2026-10-02T00:00:00.000Z');
const dryRun = process.argv.includes('--dry-run');

async function main() {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not configured');
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const matches = [];
    for (const name of ['beebrain', 'frt']) {
      const user = await User.findOne({ username: { $regex: '^' + name + '$', $options: 'i' } }).select('_id username').lean();
      if (!user) continue;
      const row = await ThirdPartySubmission.findOne({ platform: 'zeroauthoritydao', userId: user._id, createdAt: { $gte: cutoff } })
        .select('_id externalBountyId bountyName userId summary zadSubmissionId status createdAt').sort({ createdAt: -1 }).lean();
      if (row) matches.push({ ...row, submitter: user.username });
    }

    console.log(JSON.stringify(matches.map(({ _id, externalBountyId, bountyName, userId, zadSubmissionId, status, createdAt, submitter }) => ({
      id: String(_id), externalBountyId, bountyName, userId: String(userId), zadSubmissionId, status, createdAt, submitter
    })), null, 2));

    if (dryRun) {
      console.log(`Dry run: ${matches.length} row(s) matched; nothing deleted.`);
      return;
    }
    if (!process.env.CONFIRM_ZAD_CLEANUP || process.env.CONFIRM_ZAD_CLEANUP !== 'delete-beebrain-frt-2026-10-02') {
      throw new Error('Set CONFIRM_ZAD_CLEANUP=delete-beebrain-frt-2026-10-02 to confirm deletion.');
    }
    if (!matches.length) {
      console.log('No matching submissions found.');
      return;
    }
    const ids = matches.map(row => row._id);
    const result = await ThirdPartySubmission.deleteMany({ _id: { $in: ids }, platform: 'zeroauthoritydao' });
    console.log(`Deleted ${result.deletedCount} local ONBOARD3 submission row(s).`);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
