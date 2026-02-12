const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('../models/User');

const seedDemoUser = async () => {
  try {
    // Connect to MongoDB
    await mongoose.connect("mongodb+srv://toDo_db:YYSPvKFfmpMDWjSk@todo.azm8iyj.mongodb.net/?appName=Cluster0" || 'mongodb://localhost:27017/todoapp');
    console.log('Connected to MongoDB');

    // Check if demo user already exists
    const existingUser = await User.findOne({ email: 'demo@example.com' });
    
    if (existingUser) {
      console.log('Demo user already exists');
      process.exit(0);
    }

    // Create demo user
    const demoUser = new User({
      name: 'Demo User',
      email: 'demo@example.com',
      password: 'demo123'
    });

    await demoUser.save();
    console.log('✅ Demo user created successfully!');
    console.log('Email: demo@example.com');
    console.log('Password: demo123');
    
  } catch (error) {
    console.error('Error creating demo user:', error);
  } finally {
    mongoose.connection.close();
    process.exit(0);
  }
};

seedDemoUser();