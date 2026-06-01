require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Whitelist = require('../models/Whitelist');

const whitelistAdmins = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const emails = [
    'austin@afterlife.org.in',
    'dhanush@afterlife.org.in',
    'ashrith@afterlife.org.in',
    'alroy@afterlife.org.in'
  ];

  // Get an admin user to use as addedBy
  const adminUser = await User.findOne({ isAdmin: true });

  for (const email of emails) {
    const existing = await Whitelist.findOne({ email });
    if (existing) {
      console.log(`⚠️  Already whitelisted: ${email}`);
      continue;
    }

    await Whitelist.create({ email, addedBy: adminUser._id, isUsed: true, usedBy: adminUser._id });
    console.log(`✅ Whitelisted: ${email}`);
  }

  console.log('\nDone!');
  await mongoose.connection.close();
  process.exit(0);
};

whitelistAdmins().catch(err => { console.error(err.message); process.exit(1); });
