require('dotenv').config();
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const User        = require('../models/User');
  const Transaction = require('../models/Transaction');
  const { notify }  = require('../utils/notificationService');

  const credits = [
    { username: 'Ramanola',              amount: 15 },
    { username: 'brightamazingcalmsoul', amount: 10 },
  ];

  for (const { username, amount } of credits) {
    const user = await User.findOne({ username: new RegExp(`^${username}$`, 'i') });
    if (!user) { console.log(`NOT FOUND: ${username}`); continue; }

    user.usdcBalance = (user.usdcBalance || 0) + amount;
    await user.save();

    await Transaction.create({
      user: user._id,
      type: 'admin_adjustment',
      amount,
      status: 'completed',
      notes: 'Admin credit',
    });

    await notify(user._id, {
      type:    'reward',
      title:   'Balance credited!',
      message: `$${amount.toFixed(2)} USDC has been added to your balance.`,
      link:    '/dashboard/withdrawal',
    }).catch(() => {});

    console.log(`Funded @${user.username} +$${amount} → new balance $${user.usdcBalance.toFixed(2)}`);
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
