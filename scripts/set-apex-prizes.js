require('dotenv').config();
const mongoose = require('mongoose');
const Quest = require('../models/Quest');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

  try {
    const quest = await Quest.findOne({ slug: 'apex-raiders' });
    if (!quest) throw new Error('Apex Raiders campaign not found');

    quest.prizeDistribution = [{ from: 1, to: 20, amount: 5 }];
    const rewardNote = 'Reward update: Because this campaign ran for only one week, the $100 pool is shared equally among ranks 1 through 20 ($5 each). Rewards have not yet been disbursed.';
    if (!(quest.description || '').includes('Reward update:')) {
      quest.description = [quest.description?.trim(), rewardNote].filter(Boolean).join('\n\n');
    }
    quest.shortDescription = 'One-week campaign: $100 shared equally among ranks 1 through 20 ($5 each). Rewards have not yet been disbursed.';

    await quest.save();
    console.log('Updated Apex reward information only. No rewards were disbursed.');
  } finally {
    await mongoose.disconnect();
  }
}

run().catch(err => { console.error(err); process.exitCode = 1; });