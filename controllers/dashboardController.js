const User = require("../models/User");
const { ROLES } = require("../config/gamification");
const Transaction = require("../models/Transaction");
const UserQuestProgress = require("../models/UserQuestProgress");
const BountySubmission = require("../models/BountySubmission");
const ThirdPartySubmission = require("../models/ThirdPartySubmission");

// Cache total verified-user count — changes slowly, safe to cache 5 min
let _totalUsersCache = { count: 0, ts: 0 };
async function getTotalUsers() {
  if (Date.now() - _totalUsersCache.ts < 5 * 60 * 1000) return _totalUsersCache.count;
  const count = await User.countDocuments({ isVerified: true });
  _totalUsersCache = { count, ts: Date.now() };
  return count;
}

// Get user's current role
const getUserRole = (xp, joinDate) => {
    const earlyStart = new Date('2024-11-15');
    const earlyEnd = new Date('2024-12-31T23:59:59');
    const userJoinDate = new Date(joinDate);
    const isEarlyCitizen = userJoinDate >= earlyStart && userJoinDate <= earlyEnd;

    // Find role based on XP - check from highest to lowest to ensure correct match
    const roleOrder = ['major', 'legend', 'ambassador', 'contributor', 'citizen'];
    let currentRole = 'citizen'; // default

    for (const roleKey of roleOrder) {
        const roleData = ROLES[roleKey];
        if (!roleData || roleData.special) continue; // Skip special roles like early_citizen

        if (xp >= roleData.minXP && (roleData.maxXP === Infinity || xp <= roleData.maxXP)) {
            currentRole = roleKey;
            break;
        }
    }

    return {
        currentRole: ROLES[currentRole],
        roleKey: currentRole,
        isEarlyCitizen,
        xp
    };
};

// Get Dashboard
exports.getDashboard = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/auth');
    }

    const user = await User.findById(req.session.userId)
      .select('-password -notifications -activeQuests -activeBounties -courseApplications');

    if (!user) {
      return res.redirect('/auth');
    }

    if (['nft', 'trading'].includes(user.pathway)) {
      await User.updateOne({ _id: user._id }, {
        $set: { pathway: null, pathwayStatus: null, 'pathwayApplication.appliedAt': null },
        $pull: { pathwayLeadOf: { $in: ['nft', 'trading'] } }
      });
      user.pathway = null;
      user.pathwayStatus = null;
      user.pathwayLeadOf = (user.pathwayLeadOf || []).filter(p => !['nft', 'trading'].includes(p));
    }

    // Get total users (cached 5 min)
    const totalUsers = await getTotalUsers();

    // Get user role data
    const roleData = getUserRole(user.xp || 0, user.createdAt);

    // Pathway enrollment count + member list for leads
    let pathwayCount = 0;
    let pathwayMembers = null;
    if (user.pathway) {
      pathwayCount = await User.countDocuments({
        pathway: user.pathway,
        pathwayStatus: { $in: ['approved', 'auto_approved'] }
      });
      if (Array.isArray(user.pathwayLeadOf) && user.pathwayLeadOf.includes(user.pathway)) {
        pathwayMembers = await User.find({
          pathway: user.pathway,
          pathwayStatus: { $in: ['approved', 'auto_approved'] }
        })
        .select('username profilePicture createdAt')
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
      }
    }

    // Build unified activity feed from multiple sources
    const [recentTxns, recentQuests, recentBountyWins, recentZadWins] = await Promise.all([
      Transaction.find({ user: user._id })
        .sort({ createdAt: -1 }).limit(50).lean(),
      UserQuestProgress.find({ userId: user._id, status: 'completed' })
        .sort({ completedAt: -1 }).limit(30)
        .populate('questId', 'title').lean(),
      BountySubmission.find({ userId: user._id, status: 'winner' })
        .sort({ createdAt: -1 }).limit(20)
        .populate('bountyId', 'title rewardAmount').lean(),
      ThirdPartySubmission.find({ userId: user._id, status: 'winner' })
        .sort({ createdAt: -1 }).limit(20).lean(),
    ]);

    const activityFeed = [
      ...recentTxns.map(t => ({
        kind: t.type,
        label: t.type === 'quest_reward'     ? (t.questTitle || 'Quest reward')
             : t.type === 'referral_bonus'   ? 'Referral bonus'
             : t.type === 'withdrawal'       ? 'Withdrawal'
             : t.type === 'admin_adjustment' ? 'Balance adjustment'
             : t.type,
        amount: t.amount,
        currency: 'USDC',
        status: t.status,
        txHash: t.txHash || null,
        date: t.createdAt,
      })),
      ...recentQuests.map(q => ({
        kind: 'quest_completed',
        label: q.questId?.title || 'Quest completed',
        amount: q.xpBreakdown?.totalXp || 0,
        currency: 'XP',
        status: 'completed',
        date: q.completedAt || q.updatedAt,
      })),
      ...recentBountyWins.map(b => {
        const rankLabel = b.rank === 1 ? '1st' : b.rank === 2 ? '2nd' : b.rank === 3 ? '3rd' : b.rank ? `${b.rank}th` : null;
        const title = b.bountyId?.title || null;
        const desc = rankLabel && title
          ? `You were selected as a ${rankLabel} place winner in "${title}"`
          : rankLabel
          ? `You were selected as a ${rankLabel} place winner`
          : title
          ? `You were selected as a winner in "${title}"`
          : 'You have been selected as a bounty winner';
        return {
          kind: 'bounty_won',
          label: 'Bounty champion',
          sublabel: desc,
          amount: b.amountWon || null,
          currency: b.amountWon ? 'USDC' : null,
          rank: b.rank,
          status: 'completed',
          date: b.createdAt,
        };
      }),
      ...recentZadWins.map(z => ({
        kind: 'bounty_won',
        label: 'Bounty champion',
        sublabel: z.bountyName ? `You were selected as a winner in "${z.bountyName}"` : 'You have been selected as a bounty winner',
        amount: z.amountWon || null,
        currency: z.amountWon ? (z.tokenSymbol || 'STX') : null,
        status: 'completed',
        date: z.createdAt,
      })),
      // Legacy activity stored directly on user (covers pre-UserQuestProgress era).
      // Withdrawals are excluded here — they're covered by Transaction records above.
      ...(user.recentActivity || [])
        .filter(a => {
          if (!a.action || !a.timestamp) return false;
          const lc = a.action.toLowerCase();
          if (lc.includes('logged in')) return false;
          if (lc.startsWith('started quest')) return false;
          if (lc.includes('withdrawal') || lc.includes('withdraw')) return false;
          if (lc.includes('connected wallet') || lc.includes('wallet address')) return false;
          return true;
        })
        .map(a => {
          const clean      = a.action.replace(/^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27FF}\s]+/u, '').trim();
          const xpMatch    = a.action.match(/\+(\d+(?:,\d+)?)\s*XP/i);
          const usdcMatch  = a.action.match(/\+(\d+(?:\.\d+)?)\s*USDC/i);
          const isQuest    = /completed quest:/i.test(a.action);
          const isWin      = /won.*quest|quest.*won/i.test(a.action);
          const isReferral = /referral/i.test(a.action);
          const label = isQuest
            ? clean.replace(/^completed quest:\s*/i, '').replace(/\s*\(\+[\d,]+ XP.*\)$/i, '').trim()
            : clean;
          const xpAmt  = xpMatch  ? parseInt(xpMatch[1].replace(',', ''))  : null;
          const usdAmt = usdcMatch ? parseFloat(usdcMatch[1]) : null;
          return {
            kind:     isQuest || isWin ? 'quest_completed' : isReferral ? 'referral_bonus' : 'activity',
            label:    label || a.action,
            amount:   usdAmt || xpAmt || null,
            currency: usdAmt ? 'USDC' : xpAmt ? 'XP' : null,
            status:   'completed',
            date:     a.timestamp,
          };
        }),
    ]
    .filter(e => e.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 50);

    // Add welcome activity if user just logged in
    if (!user.recentActivity) user.recentActivity = [];
    const hasRecentLogin = user.recentActivity.some(
      activity => activity.action.includes('Logged in') &&
      new Date() - new Date(activity.timestamp) < 60000 // Within last minute
    );

    if (!hasRecentLogin) {
      // Atomic update — avoids VersionError from concurrent saves
      User.findByIdAndUpdate(user._id, {
        $push: { recentActivity: { $each: [{ action: 'Logged in to dashboard', timestamp: new Date() }], $position: 0, $slice: 10 } }
      }).catch(() => {});
    }

    res.render('dashboard', {
      title: 'Dashboard',
      user: user.toObject(),
      totalUsers,
      roleData,
      pathwayCount,
      pathwayMembers,
      activityFeed,
    });

  } catch (error) {
    console.error("Dashboard error:", error);
    res.status(500).send("Error loading dashboard");
  }
};

// Update User Profile
exports.updateProfile = async (req, res) => {
  try {
    const { walletAddress } = req.body;

    const user = await User.findById(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    if (walletAddress) {
      user.walletAddress = walletAddress;

      if (!user.recentActivity) user.recentActivity = [];
      user.recentActivity.unshift({
        action: 'Connected wallet address',
        timestamp: new Date()
      });

      if (user.recentActivity.length > 10) {
        user.recentActivity = user.recentActivity.slice(0, 10);
      }
    }

    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Profile updated successfully" 
    });

  } catch (error) {
    console.error("Update profile error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error" 
    });
  }
};

// Add Quest (for testing/demo)
exports.addQuest = async (req, res) => {
  try {
    const { title, xpReward, progress } = req.body;

    const user = await User.findById(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    if (!user.activeQuests) user.activeQuests = [];
    user.activeQuests.push({
      title,
      xpReward: parseInt(xpReward) || 50,
      progress: parseInt(progress) || 0
    });

    if (!user.recentActivity) user.recentActivity = [];
    user.recentActivity.unshift({
      action: `Started quest: ${title}`,
      timestamp: new Date()
    });

    if (user.recentActivity.length > 10) {
      user.recentActivity = user.recentActivity.slice(0, 10);
    }

    await user.save();

    res.status(200).json({ 
      success: true, 
      message: "Quest added successfully" 
    });

  } catch (error) {
    console.error("Add quest error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error" 
    });
  }
};

// Complete Quest
exports.completeQuest = async (req, res) => {
  try {
    const { questIndex } = req.body;

    const user = await User.findById(req.session.userId);
    
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User not found" 
      });
    }

    if (questIndex >= 0 && questIndex < user.activeQuests.length) {
      const quest = user.activeQuests[questIndex];
      const xpEarned = quest.xpReward;

      // Add XP
      user.xp += xpEarned;

      // Remove completed quest
      user.activeQuests.splice(questIndex, 1);

      // Add activity
      if (!user.recentActivity) user.recentActivity = [];
      user.recentActivity.unshift({
        action: `Completed quest: ${quest.title} (+${xpEarned} XP)`,
        timestamp: new Date()
      });

      if (user.recentActivity.length > 10) {
        user.recentActivity = user.recentActivity.slice(0, 10);
      }

      await user.save();

      res.status(200).json({ 
        success: true, 
        message: `Quest completed! +${xpEarned} XP`,
        newXP: user.xp
      });
    } else {
      res.status(400).json({ 
        success: false, 
        message: "Invalid quest" 
      });
    }

  } catch (error) {
    console.error("Complete quest error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Server error" 
    });
  }
};