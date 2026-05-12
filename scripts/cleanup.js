require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Whitelist = require('../models/Whitelist');

const cleanup = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const toDelete = ['admin@afterlife.org.in', 'demo@example.com'];

  const result = await User.deleteMany({ email: { $in: toDelete } });
  await Whitelist.deleteMany({ email: { $in: toDelete } });
  console.log(`Deleted ${result.deletedCount} old user(s)`);

  const remaining = await User.find({}, 'name email isAdmin');
  console.log('Remaining users:');
  remaining.forEach(u => console.log(`  ${u.isAdmin ? '[admin]' : '[user] '} ${u.email}`));

  await mongoose.connection.close();
  process.exit(0);
};

cleanup().catch(err => { console.error(err.message); process.exit(1); });
