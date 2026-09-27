require('dotenv').config();
const mongoose = require('mongoose');
const Quest = require('../models/Quest');

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('MongoDB connected');

  const existing = await Quest.findOne({ slug: 'apex-raiders' });
  if (existing) {
    console.log('Apex Raiders quest already exists, skipping.');
    await mongoose.disconnect();
    process.exit(0);
  }

  const quest = new Quest({
    title: 'Apex Raiders Campaign',
    shortDescription: 'One-week campaign: $100 shared equally among ranks 1 through 20 ($5 each). Rewards have not yet been disbursed.',
    description: `Welcome to the Apex Raiders Campaign \u2014 the ultimate social raiding mission for crypto communities.\n\nThis quest is for dedicated raiders who are ready to complete daily social tasks for Eyecoin, Ginox, and StxBuzz. Our admin team adds new tasks every single day, so there is always something fresh to conquer.\n\nComplete tasks consistently to climb the leaderboard. Quality submissions are reviewed by admin and earn you extra XP \u2014 the more effort you put in, the higher you rank. Top 20 raiders share a $100 prize pool equally ($5 each). The campaign ran for only one week, and rewards have not yet been disbursed.\n\nThis quest is hosted in partnership with Eyecoin, Ginox, and StxBuzz. Get your code, apply, get approved, and start raiding today.`,
    questType: 'competition',
    category: 'special',
    difficulty: 'intermediate',
    isActive: true,
    startDate: new Date('2026-08-24T00:00:00.000Z'),
    endDate: null,
    baseXpReward: 0,
    usdcReward: 0,
    slug: 'apex-raiders',
    gated: true,
    accessCode: 'APRAI2526',
    memberApproval: true,
    isSpecialQuest: true,
    sponsors: [
      { name: 'Eyecoin', logo: '/img/partners/eyecoin.jpg' },
      { name: 'Ginox',   logo: '/img/partners/ginox.jpg' },
      { name: 'StxBuzz', logo: '/img/partners/stxbuzz.jpg' }
    ],
    competitionConfig: { enabled: true, topWinnersCount: 10, winnerBonusXP: 500 },
    prizeDistribution: [{ from: 1, to: 20, amount: 5 }],
    tasks: [],
    createdBy: null,
    approvalStatus: 'approved'
  });

  await quest.save();
  console.log('Apex Raiders Campaign quest created! ID:', quest._id.toString());
  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});
