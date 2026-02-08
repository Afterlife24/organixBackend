const express = require('express');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Whitelist = require('../models/Whitelist');
const ResetCode = require('../models/ResetCode');
const auth = require('../middleware/auth');

const router = express.Router();

// Generate JWT token with enhanced security
const generateToken = (userId) => {
  return jwt.sign(
    { 
      userId,
      iat: Math.floor(Date.now() / 1000), // Issued at time
      type: 'access' // Token type
    }, 
    process.env.JWT_SECRET, 
    { 
      expiresIn: '7d', // 7 days expiration
      issuer: 'todo-app', // Token issuer
      audience: 'todo-users' // Token audience
    }
  );
};

// @route   POST /api/auth/register
// @desc    Register a new user
// @access  Public
router.post('/register', [
  body('name').trim().isLength({ min: 1, max: 50 }).withMessage('Name must be 1-50 characters'),
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { name, email, password } = req.body;

    // Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // Check if email is whitelisted (skip for admin email)
    if (email !== 'admin@afterlife.org.in') {
      const whitelistEntry = await Whitelist.findOne({ email });
      if (!whitelistEntry) {
        return res.status(403).json({ 
          message: 'Email not authorized. Please contact admin to whitelist your email address.' 
        });
      }

      // Check if whitelist entry has already been used
      if (whitelistEntry.isUsed) {
        return res.status(400).json({ message: 'This email has already been used for registration' });
      }
    }

    // List of emails that should automatically get admin access
    const adminEmails = [
      'admin@afterlife.org.in',
      'xanderash44@gmail.com',
      'ashrith@afterlife.org.in',
      'dhanush@afterlife.org.in',
      'austinak@afterlife.org.in'
    ];

    // Create new user with admin access if email is in the list
    const isAdmin = adminEmails.includes(email);
    const user = new User({ name, email, password, isAdmin });
    await user.save();

    // Mark whitelist entry as used (skip for admin email)
    if (email !== 'admin@afterlife.org.in') {
      await Whitelist.findOneAndUpdate(
        { email },
        { isUsed: true, usedBy: user._id }
      );
    }

    // Generate token
    const token = generateToken(user._id);

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @route   POST /api/auth/login
// @desc    Login user
// @access  Public
router.post('/login', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('password').exists().withMessage('Password is required')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user._id);

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login' });
  }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', auth, async (req, res) => {
  try {
    res.json({
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        isAdmin: req.user.isAdmin
      }
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/auth/reset-password
// @desc    Reset password with access code
// @access  Public
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('code').trim().isLength({ min: 6, max: 6 }).withMessage('Access code must be 6 digits'),
  body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { email, code, newPassword } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found with this email' });
    }

    // Check if email is whitelisted
    const whitelistEntry = await Whitelist.findOne({ email });
    if (!whitelistEntry) {
      return res.status(403).json({ message: 'Email is not whitelisted' });
    }

    // Find valid reset code
    const resetCode = await ResetCode.findOne({ 
      code, 
      email,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!resetCode) {
      return res.status(400).json({ message: 'Invalid or expired access code' });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    // Mark code as used
    resetCode.isUsed = true;
    resetCode.usedAt = new Date();
    await resetCode.save();

    res.json({ message: 'Password reset successfully. You can now login with your new password.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Server error during password reset' });
  }
});

// @route   POST /api/auth/verify-reset-code
// @desc    Verify if reset code is valid
// @access  Public
router.post('/verify-reset-code', [
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email'),
  body('code').trim().isLength({ min: 6, max: 6 }).withMessage('Access code must be 6 digits')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { email, code } = req.body;

    // Check if user exists
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ message: 'User not found with this email' });
    }

    // Check if email is whitelisted
    const whitelistEntry = await Whitelist.findOne({ email });
    if (!whitelistEntry) {
      return res.status(403).json({ message: 'Email is not whitelisted' });
    }

    // Find valid reset code
    const resetCode = await ResetCode.findOne({ 
      code, 
      email,
      isUsed: false,
      expiresAt: { $gt: new Date() }
    });

    if (!resetCode) {
      return res.status(400).json({ message: 'Invalid or expired access code' });
    }

    res.json({ 
      message: 'Access code is valid',
      valid: true 
    });
  } catch (error) {
    console.error('Verify reset code error:', error);
    res.status(500).json({ message: 'Server error during verification' });
  }
});

module.exports = router;