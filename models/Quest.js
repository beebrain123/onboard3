const mongoose = require("mongoose");

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  order: {
    type: Number,
    required: true
  },
  taskType: {
    type: String,
    enum: ['social', 'submission', 'verification', 'quiz', 'external', 'daily', 'poll', 'webhook', 'discord_join', 'telegram_join', 'image_upload'],
    default: 'submission'
  },
  // NEW: XP reward per task
  xpReward: {
    type: Number,
    default: 0
  },
  // Day offset from quest startDate when this task becomes available (0 = immediately)
  availableFromDay: {
    type: Number,
    default: 0
  },
  isDaily: {
    type: Boolean,
    default: false
  },
  buttonText: {
    type: String,
    default: null
  },
  buttonLink: {
    type: String,
    default: null
  },
  inputLabel: {
    type: String,
    default: null
  },
  inputName: {
    type: String,
    default: null
  },
  inputType: {
    type: String,
    enum: ['text', 'link', 'file', 'none'],
    default: 'link'
  },
  requirements: {
    url: String,
    platform: String,
    action: String
  },
  validationUrl: {
    type: String
  },
  // X/Twitter follow verification - the username the user must follow
  twitterFollowTarget: {
    type: String,
    default: null
  },
  // Poll task options
  pollOptions: [{
    text: { type: String, required: true },
    votes: { type: Number, default: 0 }
  }],
  // Webhook verification URL
  webhookUrl: {
    type: String,
    default: null
  },
  requiresApproval: {
    type: Boolean,
    default: false
  },
  // Discord join verification
  discordGuildId: {
    type: String,
    default: null
  },
  discordGuildName: {
    type: String,
    default: null
  },
  // Telegram join verification (specific group/channel)
  telegramChatId: {
    type: String,
    default: null
  },
  telegramChatName: {
    type: String,
    default: null
  },
  // Anti-garbage validation settings
  validation: {
    requiresLink: { type: Boolean, default: false },
    requiresText: { type: Boolean, default: false },
    minTextLength: { type: Number, default: 0 },
    minEngagement: { type: Number, default: 0 }, // min likes/upvotes
    requiredKeywords: [String], // keywords that must be in submission
    linkValidation: {
      allowDuplicates: { type: Boolean, default: true },
      mustContain: [String], // URL must contain these strings (e.g., ['twitter.com', 'x.com'])
      mustBeStatus: { type: Boolean, default: false }, // for Twitter - must be status/tweet not profile
      minLikes: { type: Number, default: 0 },
      mustBePublic: { type: Boolean, default: true }
    },
    requiresReferral: { type: Boolean, default: false },
    referralMustCompleteTask: { type: Boolean, default: false }
  }
});

const questSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    required: true
  },
  shortDescription: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['development', 'social', 'learning', 'community', 'special', 'nft'],
    default: 'learning'
  },
  difficulty: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced', 'expert'],
    default: 'beginner'
  },
  
  // ==================== NEW QUEST TYPES ====================
 questType: {
  type: String,
  enum: ['standard', 'referral_boost', 'fcfs', 'competition', 'permanent', 'daily', 'weekly', 'monthly', 'special'],
  default: 'standard'
    // standard = old permanent quests
    // referral_boost = earn bonus XP for referrals who join
    // fcfs = first come first serve, no referral bonus
    // competition = leaderboard-based with rankings
  },
  
  // ==================== QUEST DATES ====================
  startDate: {
    type: Date,
    default: null // null = starts immediately
  },
  endDate: {
    type: Date,
    default: null // null = no end date
  },
  
  // ==================== REFERRAL SYSTEM ====================
  referralConfig: {
    enabled: {
      type: Boolean,
      default: false
    },
    // XP bonus per referral who JOINS the quest
    xpPerReferralJoin: {
      type: Number,
      default: 0
    },
    // XP bonus per referral who COMPLETES the quest
    xpPerReferralComplete: {
      type: Number,
      default: 0
    }
  },
  
  // ==================== BATCH RELEASE (FCFS only, optional) ====================
  batchConfig: {
    enabled:       { type: Boolean, default: false },
    batchSize:     { type: Number,  default: 50 },   // spots per batch
    intervalHours: { type: Number,  default: 48 }    // hours between each batch drop
  },

  // ==================== COMPETITION SETTINGS ====================
  competitionConfig: {
    enabled: {
      type: Boolean,
      default: false
    },
    // Number of winners (top 10, top 20, etc.)
    topWinnersCount: {
      type: Number,
      default: 10
    },
    // Bonus XP for winners
    winnerBonusXP: {
      type: Number,
      default: 0
    },
    firstPlacePercent: {
      type: Number,
      default: 50,
      min: 0,
      max: 100
    },
    secondPlacePercent: {
      type: Number,
      default: 30,
      min: 0,
      max: 100
    },
    // Percentage of the USDC prize pool assigned to each place, in rank order.
    rankPercentages: { type: [Number], default: [] }
  },
  
  // ==================== REWARDS ====================
  // Base XP (given when quest is completed)
  baseXpReward: {
    type: Number,
    default: 0
  },
  usdcReward: {
    type: Number,
    default: 0
  },
  badgeReward: {
    type: String,
    default: null
  },

  // How the USDC budget is distributed per person
  rewardPlan: {
    rewardPerPerson: { type: Number, default: 0 }, // USDC each winner receives
    maxWinners:      { type: Number, default: 0 }  // how many people can win (0 = unlimited)
  },

  // Quest details
  estimatedDuration: {
    type: String,
    default: "1-2 hours"
  },
  tasks: [taskSchema],
  
  // Daily tasks (can be added/removed by admin)
  dailyTasks: [taskSchema],
  
  // Resources
  resources: [{
    title: { type: String },
    url: { type: String },
    type: { type: String }
  }],
  
  // Status and visibility
  isActive: {
    type: Boolean,
    default: true
  },

  // Track if rewards have been distributed after quest ends
  rewardsDistributed: {
    type: Boolean,
    default: false
  },
  rewardsDistributedAt: {
    type: Date,
    default: null
  },

  maxParticipants: {
    type: Number,
    default: null // null = unlimited
  },
  
  // Stats
  totalParticipants: {
    type: Number,
    default: 0
  },
  totalCompletions: {
    type: Number,
    default: 0
  },
  totalAttempts: {
    type: Number,
    default: 0
  },
  averageCompletionTime: {
    type: Number,
    default: 0
  },
  
  image: {
    type: String,
    default: null
  },

  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'approved'
  },
  approvalNote: { type: String, default: '' },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  sponsoredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Business',
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },

  // Prize distribution tiers (e.g. rank 1-3 → $50 each)
  prizeDistribution: [{
    from:   { type: Number },
    to:     { type: Number },
    amount: { type: Number }
  }],

  // Gated quest / special quest settings
  slug:           { type: String, unique: true, sparse: true },
  gated:          { type: Boolean, default: false },
  accessCode:     { type: String,  default: null },
  memberApproval: { type: Boolean, default: false },
  sponsors:          [{ name: { type: String }, logo: { type: String } }],
  isSpecialQuest:    { type: Boolean, default: false },
  telegramGroupLink: { type: String, default: null }
});

// Update timestamp on save
questSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

questSchema.methods.isCurrentlyActive = function() {
  const now = new Date();

  if (!this.isActive) return false;

  // Check start date
  if (this.startDate && now < this.startDate) return false;

  // Check end date
  if (this.endDate && now > this.endDate) return false;

  // Check max participants
  if (this.maxParticipants && this.totalParticipants >= this.maxParticipants) return false;

  return true;
};

// Check if quest has ended (past end date)
questSchema.methods.hasEnded = function() {
  if (!this.endDate) return false;
  return new Date() > this.endDate;
};

// Get quest status for display
questSchema.methods.getDisplayStatus = function() {
  const now = new Date();

  if (!this.isActive) return 'inactive';

  // Not started yet
  if (this.startDate && now < this.startDate) return 'upcoming';

  // Quest has ended
  if (this.endDate && now > this.endDate) {
    if (this.rewardsDistributed) return 'completed';
    return 'distributing'; // Ended but rewards not yet distributed
  }

  // Max participants reached
  if (this.maxParticipants && this.totalParticipants >= this.maxParticipants) return 'full';

  return 'active';
};

module.exports = mongoose.model("Quest", questSchema);
