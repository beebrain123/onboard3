/**
 * ZAD profile — scan /settings page chunks for profile update action
 * Run: node scripts/test-zad-profile.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

const ZAD_BASE = 'https://zeroauthoritydao.com';
const { getPublicKeyFromPrivate, hashMessage } = require('@stacks/encryption');
const { getAddressFromPrivateKey, signWithKey } = require('@stacks/transactions');
const { signatureVrsToRsv } = require('@stacks/common');
const bip39 = require('@scure/bip39');
const bip32 = require('@scure/bip32');

function personalSign(privKey, msg) {
  const hash = hashMessage(msg);
  return signatureVrsToRsv(signWithKey(privKey.slice(0,64) + '01', Buffer.from(hash).toString('hex')));
}
async function authenticate(privKey, username) {
  const address = getAddressFromPrivateKey(privKey);
  const pubKey  = getPublicKeyFromPrivate(privKey.slice(0,64));
  const nonce   = (await axios.get(`${ZAD_BASE}/api/auth/nonce`, { timeout: 8000 })).data.nonce;
  const msg = [`${ZAD_BASE} wants you to sign in with your Stacks account:`, address, '',
    'Cerulean Marketplace', '', `URI: ${ZAD_BASE}`, 'Version: 1', 'Chain ID: 1',
    `Nonce: ${nonce}`, `Issued At: ${new Date().toISOString()}`].join('\n');
  const res = await axios.post(`${ZAD_BASE}/api/auth/wallet-signin`, {
    message: msg, signature: personalSign(privKey, msg),
    walletType: 'leather', chain: 'Stacks', nonce, publicKey: pubKey,
    username, name: username, displayName: username,
  }, { headers: { 'Content-Type': 'application/json' }, timeout: 12000 });
  const cookieStr = (res.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');
  return { cookieStr, address };
}

async function getActionHashesFromPage(url, cookieStr) {
  const r = await axios.get(url, { headers: { 'Cookie': cookieStr, 'Accept': 'text/html' }, timeout: 10000 });
  const html = typeof r.data === 'string' ? r.data : '';
  const chunkSrcs = [...html.matchAll(/src="(\/_next\/static\/chunks\/[^"]+\.js)"/g)].map(m => m[1]);

  const actionHashes = new Set();
  for (const src of chunkSrcs) {
    try {
      const chunkRes = await axios.get(`${ZAD_BASE}${src}`, { timeout: 8000 });
      const text = typeof chunkRes.data === 'string' ? chunkRes.data : JSON.stringify(chunkRes.data);
      for (const m of text.matchAll(/\(["']([a-f0-9]{40})["']/g)) actionHashes.add(m[1]);
    } catch {}
  }
  return { hashes: [...actionHashes], chunkCount: chunkSrcs.length };
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  const User = require('../models/User');
  const user = await User.findOne({ stacksWalletIndex: { $ne: null } })
    .select('username stacksWalletIndex').lean();
  if (!user) { console.log('No wallet user.'); return process.exit(0); }

  const seed  = await bip39.mnemonicToSeed(process.env.STACKS_MASTER_SEED);
  const child = bip32.HDKey.fromMasterSeed(seed).derive(`m/44'/5757'/0'/0`).deriveChild(user.stacksWalletIndex);
  const privKey = Buffer.from(child.privateKey).toString('hex') + '01';
  const { cookieStr, address } = await authenticate(privKey, user.username);
  console.log(`User: @${user.username} | address: ${address}\n`);

  // Pages to scan
  const pagesToScan = ['/settings', '/profile/edit', '/user/settings', '/account', '/account/settings'];
  const knownProfileHashes = new Set([
    // from the /profile page scan
    '56a9be248a1e9eb9700954863d740b6952d5ac42','588dc20f782e624562347a47fc6e08fe86aaae99',
    '58a65123fad83660c59aff1cb35ef8033b8f4596','826939118db8656f1b3f286b56a1742bcc052b5a',
    '16fe503d40dcaab4c006bc7ecc0cffe22de282cf','41fb6e67e3955f6804d06d1da1955db40f1cefb1',
    'e9c36ad6fbac8dc33bb85878923f1355dd76cbdd','2b2b2b292d49fe599ece5d253f843e5c302db9b7',
    '091a6939ee7a34eaedd56b37a388c7b0ef267f1f','084456dca4ddb93153556194e31a2a95da4477bb',
    '516d84cc9c345c27f0be7bec29eaba79b9c6637f','21644103827ce03240699808a681564ff1d5d7e0',
    '00e0c7f8b37ecbba9e9480292173e2c10874562b','b406a9b51e34c89d9b07121e547a76616b2417c8',
    '4d7f511e3aed9967f55c6be56bef6bffb0c7bb8b','004c6de5f1cfefc9965c7ac5a3e051a07fcde1b2',
    '6cbe8c93fb710967f41684e2d03c495d8895a393','db8221deb5eda1ebffe98847f0cd72065ad7b73e',
    '13b35c40ed6572e56004b9107158ff6031eba5e8','ec0c4ba5407f61380e08ea5eb0b2d3f3cadd361a',
    '684e86e176ad10a5d14dd6b0be2f5a86fe221e02','bdcd7a68de0630eba949ac958ffdf50d3030027e',
    'd1be52bea432130304f60595746da2fd49825429','8d731455fb3528497830ea5546353e5ad27ee712',
    '0eb314db1af554176604beaa9e234baed09668b3','5e9fa75c20d3f440abd5bf8faef5f7d6391760dc',
    '1baff3dcd411e2a16a8c680c54ed74f442923793','eb16da6b0c4cba6cf0f69647e4506395aa3204d8',
    '9cd4c6ddd78949aed867a1c6e32369b4d4cc215e','08b864af79fd691049474f25059425153b3bea6b',
    '4be4bab85bfd3db5c36d84e6d5732920970a7c7f','6ad34f79d9d4edabe8bf268dc4370052953e6233',
    'acc603c2836f967b4aad0370af5403ce892b8326','7a3ba8eabd2006f96ef925182834478278957bbb',
    '821826437ad62ba277a38c2cb6d9e3a3a1a19848','636566358d21d641b6cc91729aeecbcde7b28bad',
    'a2f433f17f6e7392b9826741f2d5ea001d851005','922d1c8d67a30064348dc624f2093375fd5b78ca',
    '70b2cbb742c8c6a3f6bb57b3f8f84df28e5ecb02','de4fab7e81f6da7c1e3f4c6c78022cc32e3d24b9',
    'eb29bfbd9d3c317cbf3c7272865ecb52a8f9bcfd','699ca895fb980dc0cd0e429e534702a8572b1f20',
    '4a1c52455cc4b97698fb276c78fccde55c4a36bd','c0d736939c5d8e41a0a6c31393fe308e1478ed94',
    'e588ef034d02a3aa57192f80e879a2a88fdfa05d','12edb9ea8d4ef0f170f8f6e5bca55f99fe3991ed',
    '929612fe522d264a9310124fbdb8373594c81778','5e07f0512bcd82599076d1a590ff515df3be4522',
    '583acab14e86efdfcc3cf7c987e1a0e98bacd562',
  ]);

  for (const page of pagesToScan) {
    try {
      const { hashes, chunkCount } = await getActionHashesFromPage(`${ZAD_BASE}${page}`, cookieStr);
      const newHashes = hashes.filter(h => !knownProfileHashes.has(h));
      console.log(`\n${page}: ${chunkCount} chunks, ${hashes.length} total hashes, ${newHashes.length} NEW hashes`);

      if (newHashes.length > 0) {
        console.log('New hashes to try:', newHashes);
        const body = { username: user.username, name: user.username, displayName: user.username, bio: '', website: '', twitter: '', avatarUrl: '' };
        for (const hash of newHashes) {
          try {
            const r = await axios.post(`${ZAD_BASE}${page}`, [body], {
              headers: {
                'Cookie': cookieStr, 'Content-Type': 'application/json',
                'Next-Action': hash, 'Next-Router-State-Tree': '%5B%22%22%2C%7B%7D%5D',
                'Origin': ZAD_BASE, 'Referer': `${ZAD_BASE}${page}`,
              },
              timeout: 8000,
            });
            const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
            console.log(`  ${hash.slice(0,8)} → ${r.status}: ${text.slice(0, 200)}`);
          } catch (e) {
            if (e.response?.status && e.response.status !== 404)
              console.log(`  ${hash.slice(0,8)} → ${e.response.status}: ${JSON.stringify(e.response.data||'').slice(0,100)}`);
          }
        }
      }
    } catch (e) {
      console.log(`\n${page}: ${e.response?.status || e.message}`);
    }
  }

  // Final profile state
  console.log('\n═══ Final profile state ═══');
  const r = await axios.get(`${ZAD_BASE}/api/users/${address}`, { headers: { 'Cookie': cookieStr }, timeout: 5000 });
  const u = r.data?.user || r.data;
  console.log('username:', u.username);

  await mongoose.disconnect();
}

main().catch(e => { console.error(e.stack); process.exit(1); });
