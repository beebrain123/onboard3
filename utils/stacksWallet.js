const bip32   = require('@scure/bip32');
const bip39   = require('@scure/bip39');
const crypto  = require('crypto');
const { wordlist } = require('@scure/bip39/wordlists/english');
const { makeSTXTokenTransfer, makeContractCall, broadcastTransaction, sponsorTransaction, AnchorMode, getAddressFromPrivateKey, stringAsciiCV, signWithKey } = require('@stacks/transactions');
const { signatureVrsToRsv } = require('@stacks/common');
const { STACKS_MAINNET } = require('@stacks/network');
const { getPublicKeyFromPrivate, hashMessage } = require('@stacks/encryption');
const axios  = require('axios');

const HIRO_API    = 'https://api.mainnet.hiro.so';
const STACKS_PATH = "m/44'/5757'/0'/0";
const NETWORK_FEE = BigInt(2000); // 0.002 STX

// Cache parent HD key in memory — derived once, used for all users
let _parent    = null;
let _parentAt  = 0;

async function getParent() {
  if (_parent) return _parent;
  const mnemonic = process.env.STACKS_MASTER_SEED;
  if (!mnemonic) throw new Error('STACKS_MASTER_SEED not set in environment');
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.HDKey.fromMasterSeed(seed);
  _parent = root.derive(STACKS_PATH);
  return _parent;
}

function derivePrivKey(parent, index) {
  const child = parent.deriveChild(index);
  return Buffer.from(child.privateKey).toString('hex') + '01'; // compressed
}

async function getAddress(index) {
  const parent = await getParent();
  return getAddressFromPrivateKey(derivePrivKey(parent, index));
}

async function getBalance(address, retries = 2) {
  const headers = {};
  if (process.env.HIRO_API_KEY) headers['x-api-key'] = process.env.HIRO_API_KEY;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await axios.get(`${HIRO_API}/extended/v1/address/${address}/balances`, { timeout: 10000, headers });
      const locked = parseInt(res.data.stx?.locked  || '0');
      const total  = parseInt(res.data.stx?.balance || '0');
      return Math.max(0, total - locked);
    } catch (err) {
      const status = err.response?.status;
      const errMsg = status || err.code || err.message;
      console.error(`[getBalance] attempt ${attempt+1}/${retries+1} failed for ${address.slice(0,10)}...: ${errMsg}`);
      if (attempt < retries) {
        // Wait longer on rate-limit, shorter on other errors
        await new Promise(r => setTimeout(r, status === 429 ? 2500 : 1000));
      }
    }
  }
  return -1;
}

// STX price cache (10 min TTL)
let _stxPrice = 0, _stxPriceAt = 0;
async function getSTXPrice() {
  if (_stxPrice && Date.now() - _stxPriceAt < 600000) return _stxPrice;
  try {
    const r = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=blockstack&vs_currencies=usd', { timeout: 6000 });
    _stxPrice   = r.data.blockstack?.usd || 0;
    _stxPriceAt = Date.now();
  } catch {}
  return _stxPrice;
}

// Sweep user wallet → main wallet, credit user USDC (minus platform fee)
async function sweepWallet(userId) {
  const User    = require('../models/User');
  const mainWallet = process.env.STACKS_MAIN_WALLET;
  if (!mainWallet) throw new Error('STACKS_MAIN_WALLET not set');

  const user = await User.findById(userId);
  if (!user || user.stacksWalletIndex == null) throw new Error('User has no Stacks wallet');

  const parent  = await getParent();
  const privKey = derivePrivKey(parent, user.stacksWalletIndex);
  const address = getAddressFromPrivateKey(privKey);

  const microSTX = await getBalance(address);
  if (microSTX <= 0) throw new Error('Wallet has no balance');
  if (BigInt(microSTX) <= NETWORK_FEE) throw new Error('Balance too low to cover network fee');

  const sendAmount = BigInt(microSTX) - NETWORK_FEE;

  const network = STACKS_MAINNET;
  const tx = await makeSTXTokenTransfer({
    recipient:  mainWallet,
    amount:     sendAmount,
    senderKey:  privKey,
    network,
    anchorMode: AnchorMode.Any,
    fee:        NETWORK_FEE,
  });

  const result = await broadcastTransaction({ transaction: tx, network });
  if (result.error) throw new Error(result.error);

  // Calculate USDC credit (90% of value)
  const stxPrice   = await getSTXPrice();
  const totalSTX   = Number(sendAmount) / 1_000_000;
  const totalUSD   = totalSTX * stxPrice;
  const platformCut = totalUSD * 0.10;
  const userCredit  = Math.round((totalUSD - platformCut) * 100) / 100;

  user.usdcBalance     = Math.round(((user.usdcBalance || 0) + userCredit) * 100) / 100;
  user.stacksBalance   = 0;
  user.stacksBalanceUSD = 0;
  user.stacksCheckedAt = new Date();
  if (!user.recentActivity) user.recentActivity = [];
  user.recentActivity.unshift({
    action: `Bounty reward swept: $${userCredit} USDC credited (${totalSTX.toFixed(4)} STX, 10% platform fee deducted)`,
    timestamp: new Date()
  });
  if (user.recentActivity.length > 10) user.recentActivity = user.recentActivity.slice(0, 10);
  await user.save();

  return { txId: result.txid, totalSTX, totalUSD, platformCut, userCredit };
}

// Assign a wallet to a user (on first bounty submission)
async function assignWallet(userId) {
  const User    = require('../models/User');
  const Counter = require('../models/Counter');

  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');
  if (user.stacksAddress) return { address: user.stacksAddress, index: user.stacksWalletIndex };

  const counter = await Counter.findByIdAndUpdate(
    'stacksWalletIndex',
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  const index   = counter.seq - 1;
  const address = await getAddress(index);

  user.stacksWalletIndex = index;
  user.stacksAddress     = address;
  await user.save();

  // Immediately register the ZAD account in background so the profile has the
  // user's name from day one — long before their first bounty submission.
  // Non-blocking: wallet assignment still returns instantly even if ZAD is slow.
  setImmediate(() =>
    ensureZADProfile(userId).catch(e =>
      console.error('[ZAD] Initial account setup failed (non-blocking):', e.message)
    )
  );

  return { address, index };
}

const ZAD_CONTRACT_ADDRESS = 'SP2GW18TVQR75W1VT53HYGBRGKFRV5BFYNAF5SS5J';
const ZAD_CONTRACT_NAME    = 'ZADAO-V2-MultiW-Bounty';
const FEE_WALLET_PATH      = "m/44'/5757'/1'/0/0"; // separate account, never used for user wallets
const SPONSOR_FEE          = BigInt(3000); // 0.003 STX per submission

// Derive the ONBOARD3 fee wallet key (used to sponsor tx fees)
async function getFeeKey() {
  const mnemonic = process.env.STACKS_MASTER_SEED;
  if (!mnemonic) throw new Error('STACKS_MASTER_SEED not set');
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const root = bip32.HDKey.fromMasterSeed(seed);
  const child = root.derive(FEE_WALLET_PATH);
  return Buffer.from(child.privateKey).toString('hex') + '01';
}

// Submit a bounty entry on-chain to ZeroAuthDAO from the user's custodial wallet
// Fee is sponsored by ONBOARD3's fee wallet — user wallet needs zero STX balance
// ZAD's Server Action broadcasts the tx AND creates the DB record (so it appears on their site)
async function submitBountyOnChain(userId, bountyId, summary, submissionUrl) {
  const User = require('../models/User');
  const user = await User.findById(userId).select('stacksWalletIndex stacksAddress username profilePicture').lean();
  if (!user || user.stacksWalletIndex == null) throw new Error('User has no Stacks wallet assigned');

  const parent  = await getParent();
  const userKey = derivePrivKey(parent, user.stacksWalletIndex);
  const feeKey  = await getFeeKey();
  const network = STACKS_MAINNET;

  // Build transaction with sponsored: true so user wallet pays no fees
  const tx = await makeContractCall({
    contractAddress: ZAD_CONTRACT_ADDRESS,
    contractName:    ZAD_CONTRACT_NAME,
    functionName:    'submit-entry',
    functionArgs:    [stringAsciiCV(bountyId)],
    senderKey:       userKey,
    network,
    anchorMode:      AnchorMode.Any,
    sponsored:       true,
  });

  // Fee wallet signs the sponsored portion
  const sponsored = await sponsorTransaction({
    transaction:       tx,
    sponsorPrivateKey: feeKey,
    fee:               SPONSOR_FEE,
    network,
  });

  // serialize() already returns a hex string — do NOT wrap in Buffer.from() or it double-encodes
  const raw = sponsored.serialize();
  const signedTxHex = typeof raw === 'string' ? raw : Buffer.from(raw).toString('hex');

  // Call ZAD's Server Action (broadcasts + creates DB record so it appears on their platform)
  const webResult = await submitToZADWebAPI(userKey, bountyId, summary || '', submissionUrl || null, signedTxHex, {
    username: user.username || null,
    avatarUrl: user.profilePicture || null,
  });
  console.log('[ZAD] Web2 result:', webResult);

  // If ZAD broadcast it, use the txId from their response; otherwise fall back to broadcasting ourselves
  let txId = webResult.txId;
  if (!txId) {
    const result = await broadcastTransaction({ transaction: sponsored, network });
    // Treat "already in mempool/confirmed" as success — ZAD may have already broadcast it
    const alreadyExists = result.error && /ConflictingNonce|AlreadyExists|already/i.test(result.reason || result.error);
    if (result.error && !alreadyExists) {
      throw new Error(result.error + (result.reason ? ': ' + result.reason : ''));
    }
    txId = result.txid || null;
  }

  if (!txId) throw new Error('Failed to submit transaction to Stacks network');

  return { txId, address: user.stacksAddress, zadSubId: webResult.zadSubId };
}

async function getFeeWalletInfo() {
  const feeKey  = await getFeeKey();
  const address = getAddressFromPrivateKey(feeKey);
  const microSTX = await getBalance(address);
  const stxPrice = await getSTXPrice();
  const stx = microSTX > 0 ? microSTX / 1_000_000 : 0;
  return { address, microSTX: Math.max(0, microSTX), stx, usd: Math.round(stx * stxPrice * 100) / 100 };
}

const ZAD_BASE = 'https://zeroauthoritydao.com';
function cloudinaryCredentials() {
  let cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  let apiKey = process.env.CLOUDINARY_API_KEY;
  let apiSecret = process.env.CLOUDINARY_API_SECRET;
  if ((!cloudName || !apiKey || !apiSecret) && process.env.CLOUDINARY_URL) {
    try {
      const parsed = new URL(process.env.CLOUDINARY_URL);
      cloudName = cloudName || parsed.hostname;
      apiKey = apiKey || decodeURIComponent(parsed.username);
      apiSecret = apiSecret || decodeURIComponent(parsed.password);
    } catch {}
  }
  return cloudName && apiKey && apiSecret ? { cloudName, apiKey, apiSecret } : null;
}

async function getZADAvatarUrl(avatarData, walletAddress) {
  if (typeof avatarData === 'string' && /^https?:\/\//i.test(avatarData)) return avatarData;
  if (typeof avatarData !== 'string' || !walletAddress) return null;
  if (!/^data:image\/(png|jpeg|jpg|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(avatarData)) return null;

  const credentials = cloudinaryCredentials();
  if (!credentials) {
    console.warn('[Cloudinary] Avatar sync skipped; configure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.');
    return null;
  }

  const sourceHash = crypto.createHash('sha256').update(avatarData).digest('hex');
  const User = require('../models/User');
  const user = await User.findOne({ stacksAddress: walletAddress })
    .select('_id zeroAuthAvatarHash zeroAuthAvatarUrl').lean();
  if (!user) return null;
  if (user.zeroAuthAvatarHash === sourceHash && user.zeroAuthAvatarUrl) return user.zeroAuthAvatarUrl;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const publicId = `onboard3/stacks-avatars/${walletAddress}`;
  const signedParams = { overwrite: 'true', public_id: publicId, timestamp };
  const signaturePayload = Object.keys(signedParams).sort()
    .map(key => `${key}=${signedParams[key]}`).join('&') + credentials.apiSecret;
  const signature = crypto.createHash('sha1').update(signaturePayload).digest('hex');
  const form = new URLSearchParams({ file: avatarData, api_key: credentials.apiKey, signature, ...signedParams });

  try {
    const response = await axios.post(
      `https://api.cloudinary.com/v1_1/${encodeURIComponent(credentials.cloudName)}/image/upload`,
      form.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 20000, maxBodyLength: 2000000 }
    );
    const secureUrl = response.data?.secure_url;
    if (!secureUrl) throw new Error('Cloudinary response did not include secure_url');
    await User.updateOne({ _id: user._id }, {
      $set: { zeroAuthAvatarHash: sourceHash, zeroAuthAvatarUrl: secureUrl }
    });
    return secureUrl;
  } catch (error) {
    console.warn('[Cloudinary] Avatar upload failed:', error.response?.status || error.message);
    return null;
  }
}
// Build a SIWE/SIWS message exactly as ZeroAuthDAO's frontend does
// They use: new SiweMessage({ statement:"Cerulean Marketplace", domain: origin, address, uri: origin, ... })
function buildSiwsMessage(address, nonce) {
  const origin   = 'https://zeroauthoritydao.com';
  const issuedAt = new Date().toISOString();
  // Standard EIP-4361 prepareMessage() output format
  return [
    `${origin} wants you to sign in with your Stacks account:`,
    address,
    '',
    'Cerulean Marketplace',
    '',
    `URI: ${origin}`,
    'Version: 1',
    'Chain ID: 1',
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join('\n');
}

// Sign a UTF-8 message using Stacks personal sign (Leather wallet RSV format)
// Leather's stx_signMessage returns RSV: compact(r+s 64 bytes) + recovery(1 byte)
function stacksPersonalSign(privKeyHex, message) {
  const hash    = hashMessage(message);
  const hashHex = Buffer.from(hash).toString('hex');
  // signWithKey produces VRS; convert to RSV to match Leather wallet output
  return signatureVrsToRsv(signWithKey(privKeyHex + '01', hashHex));
}

// Authenticate a custodial wallet with ZeroAuthDAO using SIWS
// Returns session cookies to use in subsequent requests
async function authenticateWithZAD(privKey, profile = {}) {
  const privKeyHex = privKey.slice(0, 64);
  const address    = getAddressFromPrivateKey(privKey);
  const pubKey     = getPublicKeyFromPrivate(privKeyHex);

  const nonceRes = await axios.get(`${ZAD_BASE}/api/auth/nonce`, { timeout: 8000 });
  const nonce    = nonceRes.data.nonce;

  const message   = buildSiwsMessage(address, nonce);
  const signature = await stacksPersonalSign(privKeyHex, message);
  const zadAvatarUrl = await getZADAvatarUrl(profile.avatarUrl, address);

  let res;
  try {
    res = await axios.post(`${ZAD_BASE}/api/auth/wallet-signin`, {
      message,
      signature,
      walletType: 'leather',
      chain:      'Stacks',
      nonce,
      publicKey:  pubKey,
      // Pass username on signin — ZAD sets display name on first account creation
      ...(typeof profile.username === 'string' && profile.username.trim() ? { username: profile.username.trim() } : {}),
      // Only pass avatarUrl if it's a real hosted URL (not a base64 data URI which ZAD can't use)
      ...(zadAvatarUrl ? { image: zadAvatarUrl, avatarUrl: zadAvatarUrl } : {}),
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 12000,
    });
  } catch (authErr) {
    const status = authErr.response?.status;
    const body   = authErr.response?.data;
    console.error('[ZAD] wallet-signin failed:', status, typeof body === 'string' ? body.slice(0, 300) : JSON.stringify(body).slice(0, 300));
    console.error('[ZAD] message was:', message.slice(0, 200));
    console.error('[ZAD] signature was:', signature.slice(0, 20) + '...');
    throw authErr;
  }

  const setCookie = res.headers['set-cookie'] || [];
  const cookieStr = setCookie.map(c => c.split(';')[0]).join('; ');
  const signinData = typeof res.data === 'object' ? res.data : {};
  // ZAD may return {user:{...}} nested or flat {id, username, ...}
  const signinUser = signinData?.user || signinData;
  console.log('[ZAD] Auth OK | user from signin:', JSON.stringify(signinData).slice(0, 300));
  return { cookieStr, address, signinUser };
}

// Try to update the ZAD user profile — attempts session-based Server Actions,
// REST endpoints, and admin-API-key approaches (in order of reliability)
// Update a ZAD user's profile through the documented session-authenticated API.
async function tryUpdateZADProfile(cookieStr, username, avatarUrl, walletAddress, signinUser) {
  if (!walletAddress) return;
  const displayName = typeof username === 'string' ? username.trim() : '';
  const existingName = signinUser?.username || signinUser?.name || signinUser?.displayName;
  const shouldSetName = !!displayName && !(typeof existingName === 'string' && existingName.trim());
  const safeAvatar = await getZADAvatarUrl(avatarUrl, walletAddress);
  const body = {
    ...(shouldSetName ? { username: displayName } : {}),
    ...(safeAvatar ? { avatarUrl: safeAvatar } : {}),
  };
  if (!Object.keys(body).length) return;
  if (!shouldSetName && existingName) console.log('[ZAD] Existing profile name retained:', existingName);
  try {
    const response = await axios.put(
      `${ZAD_BASE}/api/users/${encodeURIComponent(walletAddress)}`,
      body,
      { headers: { 'Content-Type': 'application/json', Cookie: cookieStr }, timeout: 8000 }
    );
    console.log('[ZAD] Profile updated:', response.status, JSON.stringify(response.data || {}).slice(0, 200));
  } catch (error) {
    const status = error.response?.status;
    const responseBody = error.response?.data;
    const detail = typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody || error.message);
    if ([400, 401, 403, 404].includes(status)) {
      console.warn(`[ZAD] Profile update rejected (${status}):`, detail.slice(0, 200));
      return;
    }
    console.warn('[ZAD] Profile update failed:', status || error.message, detail.slice(0, 200));
  }
}
// Submit a bounty via ZAD's Next.js Server Action — this broadcasts the tx AND creates the DB record
// signedTxHex: hex of the fully signed+sponsored transaction (ZAD broadcasts it on their end)
// profile: { username, avatarUrl } — optional, used to update ZAD account name so it shows instead of Anonymous
async function submitToZADWebAPI(privKey, bountyId, summary, submissionUrl, signedTxHex, profile = {}) {
  try {
    if (!privKey) {
      const parent = await getParent();
      privKey = derivePrivKey(parent, 0);
    }
    const { cookieStr, address, signinUser } = await authenticateWithZAD(privKey, profile);

    // Update ZAD profile with ONBOARD3 username so submissions don't show as Anonymous
    await tryUpdateZADProfile(cookieStr, profile.username, profile.avatarUrl, address, signinUser);

    // ZAD uses a Next.js Server Action for submissions (not a REST endpoint)
    // Action ID found in their bundle: 3412751565eefa5c83032aedc403d0a6c1808442
    const headers = {
      'Content-Type':            'application/json',
      'Cookie':                  cookieStr,
      'Next-Action':             '3412751565eefa5c83032aedc403d0a6c1808442',
      'Next-Router-State-Tree':  '%5B%22%22%2C%7B%7D%5D',
      'Origin':                  ZAD_BASE,
      'Referer':                 `${ZAD_BASE}/bounty/${bountyId}`,
    };

    // Include username in payload — ZAD may read it to display on their site
    const payload = [{
      bountyId, submitterAddress: address, signedTxHex, summary, submissionUrl: submissionUrl || null,
      ...(typeof profile.username === 'string' && profile.username.trim() ? { username: profile.username.trim() } : {}),
    }];

    const subRes = await axios.post(`${ZAD_BASE}/bounty/${bountyId}`, payload, { headers, timeout: 30000 });
    console.log('[ZAD] Server Action status:', subRes.status);

    const responseText = typeof subRes.data === 'string' ? subRes.data : JSON.stringify(subRes.data);
    console.log('[ZAD] Server Action response:', responseText.slice(0, 500));

    // Parse RSC (React Server Components) streaming response
    // Format: "0:[...]\n1:{...}\n" — look for submission id and txId in all lines
    let zadSubId = null;
    let txId = null;
    try {
      for (const line of responseText.split('\n')) {
        const match = line.match(/^\d+:(.*)/s);
        if (!match) continue;
        try {
          const parsed = JSON.parse(match[1]);
          const obj = Array.isArray(parsed) ? parsed[1] : parsed;
          if (obj && typeof obj === 'object') {
            if (obj.id)    zadSubId = obj.id;
            if (obj.txId)  txId     = obj.txId;
            if (obj.txid)  txId     = obj.txid;
          }
        } catch {}
      }
    } catch {}

    return { success: true, zadSubId, txId, address };
  } catch (err) {
    const status = err.response?.status;
    const body   = err.response?.data;
    console.error('[ZAD] Server Action failed:', status, (typeof body === 'string' ? body : JSON.stringify(body || err.message)).slice(0, 500));
    return { success: false, zadSubId: null, txId: null };
  }
}

// Ensure a ZAD profile exists for the user with their ONBOARD3 username.
// Called explicitly before on-chain submission so the profile is created
// even if the on-chain step fails (preventing entries from appearing as "anonymous").
async function ensureZADProfile(userId) {
  const User = require('../models/User');
  const user = await User.findById(userId)
    .select('stacksWalletIndex username profilePicture').lean();
  if (!user || user.stacksWalletIndex == null) return;
  const parent  = await getParent();
  const privKey = derivePrivKey(parent, user.stacksWalletIndex);
  const { cookieStr, address, signinUser } = await authenticateWithZAD(privKey, {
    username:  user.username  || null,
    avatarUrl: user.profilePicture || null,
  });
  await tryUpdateZADProfile(cookieStr, user.username, user.profilePicture, address, signinUser);
  console.log('[ZAD] Profile ensured for:', user.username, address);
}

module.exports = { getAddress, getBalance, getSTXPrice, sweepWallet, assignWallet, submitBountyOnChain, getFeeWalletInfo, submitToZADWebAPI, ensureZADProfile };
