require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const run = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const result = await User.findOneAndUpdate(
    { email: 'alroy@afterlife.org.in' },
    { $set: { isAdmin: false } },
    { new: true }
  );

  if (result) {
    console.log(`✅ Removed admin role from: ${result.email}`);
  } else {
    console.log('⚠️  No user found with email: alroy@afterlife.org.in');
  }

  await mongoose.connection.close();
  process.exit(0);
};

run().catch(err => { console.error(err.message); process.exit(1); });
