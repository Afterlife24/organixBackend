const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Whitelist = require('../models/Whitelist');

const seedUsers = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/todoapp');
    console.log('Connected to MongoDB');

    const seeds = [
      {
        name: 'Demo Admin',
        email: 'demoadmin@afterlife.org.in',
        password: 'admin@123',
        isAdmin: true
      },
      {
        name: 'Demo User',
        email: 'demouser@afterlife.org.in',
        password: 'demo@123',
        isAdmin: false
      }
    ];

    for (const seed of seeds) {
      // Whitelist non-admin users first
      if (!seed.isAdmin) {
        const existingWhitelist = await Whitelist.findOne({ email: seed.email });
        if (!existingWhitelist) {
          // Use any admin user as the addedBy reference
          const adminUser = await User.findOne({ isAdmin: true });
          await Whitelist.create({ email: seed.email, addedBy: adminUser._id });
          console.log(`✅ Whitelisted: ${seed.email}`);
        }
      }

      const existing = await User.findOne({ email: seed.email });
      if (existing) {
        console.log(`⚠️  User already exists: ${seed.email} — skipping`);
        continue;
      }

      const user = new User(seed);
      await user.save();
      console.log(`✅ Created ${seed.isAdmin ? 'admin' : 'regular'} user: ${seed.email} / ${seed.password}`);
    }

    console.log('\nSeeded credentials:');
    console.log('  Admin  → demoadmin@afterlife.org.in  / admin@123');
    console.log('  User   → demouser@afterlife.org.in   / demo@123');

  } catch (error) {
    console.error('Seed error:', error.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
};

seedUsers();
