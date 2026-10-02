// models/User.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

// models/User.js - Add these fields to your existing schema

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  adminRole: {
    type: String,
    enum: ['super_admin', 'operations', 'community', 'partnerships', 'finance'],
    default: null
  },
  role: {
    type: String,
    enum: ['user'],
    default: 'user'
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  verificationToken: {
    type: String
  },
  verificationTokenExpires: {
    type: Date
  },
  // Password Reset Fields
  resetPasswordToken: {
    type: String
  },
  resetPasswordTokenExpires: {
    type: Date
  },
  
  // ✅ ADD THESE NEW FIELDS FOR IP TRACKING
  registrationIP: {
    type: String,
    default: null
  },
  lastLoginIP: {
    type: String,
    default: null
  },
  lastLogin: {
    type: Date,
    default: null
  },
  
  // ... rest of your existing fields ...
  profession: {
    type: String,
    default: null
  },
  walletAddress: {
    type: String,
    default: null
  },
  usdcBalance: {
    type: Number,
    default: 0
  },
  xp: {
    type: Number,
    default: 0
  },
  questRank: {
    type: Number,
    default: null
  },
  bountyRank: {
    type: Number,
    default: null
  },
  profilePicture: {
    type: String,
    default: null
  },
  pathway: {
    type: String,
    enum: ['web3_jobs', 'ai', 'nft', 'trading', null],
    default: null
  },
  pathwayLeadOf: {
    type: [String],
    default: []
  },
  pathwayStatus: {
    type: String,
    enum: ['pending', 'auto_approved', 'approved', 'rejected', null],
    default: null
  },
  pathwayApplication: {
    reason:     { type: String, default: '' },
    experience: { type: String, default: '' },
    appliedAt:  { type: Date,   default: null },
    reviewedAt: { type: Date,   default: null },
    reviewNote: { type: String, default: '' }
  },
  bio: {
    type: String,
    default: ''
  },
  twitter: {
    type: String,
    default: ''
  },
  twitterConnected: {
    type: Boolean,
    default: false
  },
  twitterVerifiedAt: {
    type: Date,
    default: null
  },
  twitterVerificationCode: {
    type: String,
    default: null
  },
  twitterVerificationCodeExpires: {
    type: Date,
    default: null
  },
  // Twitter OAuth 2.0 Fields
  twitterId: {
    type: String
    // NO default - undefined for sparse unique index
  },
  twitterAccessToken: {
    type: String,
    default: null
  },
  twitterRefreshToken: {
    type: String,
    default: null
  },
  twitterTokenExpiry: {
    type: Date,
    default: null
  },
  github: {
    type: String,
    default: ''
  },
  // Discord OAuth Fields
  discordId: {
    type: String
    // NO default — sparse unique index
  },
  discordUsername: {
    type: String,
    default: null
  },
  discordConnected: {
    type: Boolean,
    default: false
  },
  discordConnectedAt: {
    type: Date,
    default: null
  },
  telegram: {
    type: String,
    default: ''
  },
  // Telegram Verification Fields
  telegramId: {
    type: String
    // NO default - field should be undefined (not null) for sparse unique index to work
  },
  telegramUsername: {
    type: String,
    default: null
  },
  telegramConnected: {
    type: Boolean,
    default: false
  },
  telegramVerifiedAt: {
    type: Date,
    default: null
  },
  telegramVerificationCode: {
    type: String,
    default: null
  },
  telegramVerificationCodeExpires: {
    type: Date,
    default: null
  },
  notifications: {
    newQuests: {
      type: Boolean,
      default: true
    },
    newBounties: {
      type: Boolean,
      default: true
    },
    eventReminders: {
      type: Boolean,
      default: true
    },
    weeklyDigest: {
      type: Boolean,
      default: false
    },
    submissionUpdates: {
      type: Boolean,
      default: true
    }
  },
  privacy: {
    showOnLeaderboard: {
      type: Boolean,
      default: true
    },
    publicProfile: {
      type: Boolean,
      default: true
    },
    showEarnings: {
      type: Boolean,
      default: true
    },
    showQuests: {
      type: Boolean,
      default: true
    }
  },
  activeQuests: {
    type: Array,
    default: []
  },
  activeBounties: {
    type: Array,
    default: []
  },
  courseApplications: {
    type: Array,
    default: []
  },
  recentActivity: {
    type: Array,
    default: []
  },
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: String,
    default: null
  },
  referralRewardGiven: {
    type: Boolean,
    default: false
  },
  referralStats: {
    totalReferrals: {
      type: Number,
      default: 0
    },
    activeReferrals: {
      type: Number,
      default: 0
    },
    pendingReferrals: {
      type: Number,
      default: 0
    },
    totalEarned: {
      type: Number,
      default: 0
    }
  },
  emailSent: {
    type: Boolean,
    default: false
  },
  welcomeEmailSent: {
    type: Boolean,
    default: false
  },
  isFakeUser: {
    type: Boolean,
    default: false
  },
  isBanned: {
    type: Boolean,
    default: false
  },
  banReason: {
    type: String,
    default: null
  },
  bannedAt: {
    type: Date,
    default: null
  },
  lastMonthlyClaimDate: {
    type: Date,
    default: null
  },
  monthlyClaimHistory: [{
    claimedAt: Date,
    xpAwarded: Number,
    role: String
  }],
  bannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  // Campus Ambassador Fields
  isCampusAmbassador: {
    type: Boolean,
    default: false
  },
  campusAmbassadorSince: {
    type: Date,
    default: null
  },
  campusAmbassadorData: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CampusAmbassador'
  },
  // Custodial Stacks wallet (for ZeroAuthDAO bounty payouts)
  stacksWalletIndex: { type: Number, default: null },
  stacksAddress:     { type: String, default: null },
  zeroAuthAvatarHash: { type: String, default: null },
  zeroAuthAvatarUrl:  { type: String, default: null },
  stacksBalance:     { type: Number, default: 0 },    // cached microSTX
  stacksBalanceUSD:  { type: Number, default: 0 },    // cached USD value
  usdcxBalance:      { type: Number, default: 0 },    // cached raw USDCx units (6 decimals)
  stacksPendingUSDCxSweep: { type: mongoose.Schema.Types.Mixed, default: null },
  stacksCheckedAt:   { type: Date,   default: null },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.virtual('ambassadorProfile', {
    ref: 'CampusAmbassador',
    localField: '_id',
    foreignField: 'userId',
    justOne: true
});


// Ensure virtuals are included when converting to JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });



// Protect Telegram field once verified - make it read-only
userSchema.pre("save", async function(next) {
  // If Telegram is verified and someone tries to change the telegram field
  if (this.telegramConnected && this.isModified("telegram")) {
    // Check if this is the initial verification save
    const wasVerifiedBefore = this._doc && this._doc.telegramConnected;

    // If already verified before, prevent changes to telegram field
    if (wasVerifiedBefore && this.telegram !== this._doc.telegram) {
      console.log(`⚠️ Prevented telegram field change for verified user ${this.username}`);
      this.telegram = this._doc.telegram; // Revert to original value
    }
  }

  next();
});

// Protect Twitter field once verified via OAuth - make it read-only
userSchema.pre("save", async function(next) {
  if (this.twitterConnected && this.isModified("twitter")) {
    const wasVerifiedBefore = this._doc && this._doc.twitterConnected;
    if (wasVerifiedBefore && this.twitter !== this._doc.twitter) {
      console.log(`Warning: Prevented twitter field change for verified user ${this.username}`);
      this.twitter = this._doc.twitter;
    }
  }
  next();
});

// Hash password before saving
userSchema.pre("save", async function(next) {
  if (!this.isModified("password")) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.index({ xp: -1 });        // leaderboard sort
userSchema.index({ username: 1 });   // lookup by username

module.exports = mongoose.model("User", userSchema);