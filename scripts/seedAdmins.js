require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const seedAdmins = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const admins = [
    { name: 'Austin', email: 'austin@afterlife.org.in' },
    { name: 'Dhanush', email: 'dhanush@afterlife.org.in' },
    { name: 'Ashrith', email: 'ashrith@afterlife.org.in' },
  ];

  for (const admin of admins) {
    const existing = await User.findOne({ email: admin.email });
    if (existing) {
      console.log(`⚠️  Already exists: ${admin.email} — skipping`);
      continue;
    }

    const user = new User({
      name: admin.name,
      email: admin.email,
      password: 'Afterlife@2026',
      isAdmin: true
    });
    await user.save();
    console.log(`✅ Created admin: ${admin.email}`);
  }

  console.log('\nDone!');
  await mongoose.connection.close();
  process.exit(0);
};

seedAdmins().catch(err => { console.error(err.message); process.exit(1); });
