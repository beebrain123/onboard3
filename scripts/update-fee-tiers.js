require('dotenv').config();
const mongoose = require('mongoose');
const PlatformSettings = require('../models/PlatformSettings');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const settings = await PlatformSettings.get();
  settings.feeTierSmall      = 0.5;
  settings.feeTierSmallUpTo  = 10;
  settings.feeTierMedium     = 1;
  settings.feeTierMediumUpTo = 100;
  settings.feeTierLarge      = 2;
  await settings.save();
  console.log('Fee tiers updated: <$10→$0.50 | $10-$100→$1.00 | >$100→$2.00');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
