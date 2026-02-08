const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Task = require('../models/Task');
const Whitelist = require('../models/Whitelist');
const ResetCode = require('../models/ResetCode');
const auth = require('../middleware/auth');

const router = express.Router();

// Middleware to check if user is admin
const adminAuth = async (req, res, next) => {
  try {
    if (!req.user.isAdmin) {
      return res.status(403).json({ message: 'Access denied. Admin privileges required.' });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: 'Server error during admin authentication' });
  }
};

// @route   GET /api/admin/users
// @desc    Get all users (admin only)
// @access  Private (Admin)
router.get('/users', auth, adminAuth, async (req, res) => {
  try {
    const users = await User.find({})
      .select('-password')
      .sort({ createdAt: -1 });

    // Get task counts for each user
    const usersWithStats = await Promise.all(
      users.map(async (user) => {
        const taskCount = await Task.countDocuments({ userId: user._id });
        return {
          ...user.toObject(),
          taskCount
        };
      })
    );

    res.json({ 
      users: usersWithStats,
      totalUsers: users.length 
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ message: 'Server error while fetching users' });
  }
});

// @route   GET /api/admin/stats
// @desc    Get admin dashboard stats
// @access  Private (Admin)
router.get('/stats', auth, adminAuth, async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    const totalTasks = await Task.countDocuments({});
    const completedTasks = await Task.countDocuments({ completed: true });
    
    // Get recent registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentUsers = await User.countDocuments({ 
      createdAt: { $gte: thirtyDaysAgo } 
    });

    res.json({
      totalUsers,
      totalTasks,
      completedTasks,
      recentUsers,
      completionRate: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
    });
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ message: 'Server error while fetching admin stats' });
  }
});

// @route   DELETE /api/admin/users/:id
// @desc    Delete a user and all their data (admin only)
// @access  Private (Admin)
router.delete('/users/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from deleting themselves
    if (id === req.user._id.toString()) {
      return res.status(400).json({ message: 'Cannot delete your own admin account' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Delete all user's tasks and related data
    await Task.deleteMany({ userId: id });
    
    // Delete the user
    await User.findByIdAndDelete(id);

    res.json({ message: `User ${user.name} and all their data deleted successfully` });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
});

// @route   POST /api/admin/create-task
// @desc    Create a task for a specific user (admin only)
// @access  Private (Admin)
router.post('/create-task', [
  auth,
  adminAuth,
  body('userId').isMongoId().withMessage('Valid user ID is required'),
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  body('endDate').optional().isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { userId, title, startDate, endDate } = req.body;

    // Verify target user exists
    const targetUser = await User.findById(userId);
    if (!targetUser) {
      return res.status(404).json({ message: 'Target user not found' });
    }

    // Validate date range if both dates are provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // Normalize dates to start of day for proper comparison
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      
      if (end < start) {
        return res.status(400).json({ message: 'End date must be after or equal to start date' });
      }
    }

    // Validate that if one date is provided, both should be provided
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({ message: 'Both start date and end date must be provided together, or leave both empty for static tasks' });
    }

    // Get the next order number for this task type
    let nextOrder = 1;
    if (startDate && endDate) {
      // For date-based tasks, get the highest order for this date
      const existingTasks = await Task.findTasksForDate(userId, new Date(startDate));
      if (existingTasks.length > 0) {
        const maxOrder = Math.max(...existingTasks.map(t => t.order || 0));
        nextOrder = maxOrder + 1;
      }
    } else {
      // For static tasks, get the highest order
      const existingTasks = await Task.find({ 
        userId,
        $or: [
          { startDate: null },
          { endDate: null },
          { $and: [{ startDate: { $exists: false } }, { endDate: { $exists: false } }] }
        ]
      });
      if (existingTasks.length > 0) {
        const maxOrder = Math.max(...existingTasks.map(t => t.order || 0));
        nextOrder = maxOrder + 1;
      }
    }

    const taskData = {
      title,
      userId,
      order: nextOrder,
      createdBy: req.user._id // Track who created the task
    };

    // Only add dates if both are provided
    if (startDate && endDate) {
      taskData.startDate = new Date(startDate);
      taskData.endDate = new Date(endDate);
    }

    const task = new Task(taskData);
    await task.save();
    await task.populate('subtasks');

    res.status(201).json({ 
      message: `Task created successfully for ${targetUser.name}`, 
      task,
      targetUser: {
        id: targetUser._id,
        name: targetUser.name,
        email: targetUser.email
      }
    });
  } catch (error) {
    console.error('Admin create task error:', error);
    res.status(500).json({ message: 'Server error while creating task' });
  }
});

// @route   GET /api/admin/whitelist
// @desc    Get all whitelisted emails
// @access  Private (Admin)
router.get('/whitelist', auth, adminAuth, async (req, res) => {
  try {
    const whitelistedEmails = await Whitelist.find({})
      .populate('addedBy', 'name email')
      .populate('usedBy', 'name email')
      .sort({ createdAt: -1 });

    res.json({ 
      whitelistedEmails,
      total: whitelistedEmails.length 
    });
  } catch (error) {
    console.error('Get whitelist error:', error);
    res.status(500).json({ message: 'Server error while fetching whitelist' });
  }
});

// @route   POST /api/admin/whitelist
// @desc    Add email to whitelist
// @access  Private (Admin)
router.post('/whitelist', [
  auth,
  adminAuth,
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { email } = req.body;

    // Check if email is already whitelisted
    const existingWhitelist = await Whitelist.findOne({ email });
    if (existingWhitelist) {
      return res.status(400).json({ message: 'Email is already whitelisted' });
    }

    // Check if email is already registered
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'Email is already registered as a user' });
    }

    const whitelistEntry = new Whitelist({
      email,
      addedBy: req.user._id
    });

    await whitelistEntry.save();
    await whitelistEntry.populate('addedBy', 'name email');

    res.status(201).json({ 
      message: 'Email added to whitelist successfully',
      whitelistEntry 
    });
  } catch (error) {
    console.error('Add to whitelist error:', error);
    res.status(500).json({ message: 'Server error while adding to whitelist' });
  }
});

// @route   DELETE /api/admin/whitelist/:id
// @desc    Remove email from whitelist
// @access  Private (Admin)
router.delete('/whitelist/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const whitelistEntry = await Whitelist.findById(id);
    if (!whitelistEntry) {
      return res.status(404).json({ message: 'Whitelist entry not found' });
    }

    // Prevent deletion if email has been used to register
    if (whitelistEntry.isUsed) {
      return res.status(400).json({ message: 'Cannot remove email that has been used for registration' });
    }

    await Whitelist.findByIdAndDelete(id);

    res.json({ message: 'Email removed from whitelist successfully' });
  } catch (error) {
    console.error('Remove from whitelist error:', error);
    res.status(500).json({ message: 'Server error while removing from whitelist' });
  }
});

// Helper function to generate random 6-digit code
const generateResetCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @route   GET /api/admin/reset-codes
// @desc    Get all reset codes
// @access  Private (Admin)
router.get('/reset-codes', auth, adminAuth, async (req, res) => {
  try {
    const resetCodes = await ResetCode.find({})
      .populate('generatedBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(50); // Limit to last 50 codes

    res.json({ 
      resetCodes,
      total: resetCodes.length 
    });
  } catch (error) {
    console.error('Get reset codes error:', error);
    res.status(500).json({ message: 'Server error while fetching reset codes' });
  }
});

// @route   POST /api/admin/reset-codes
// @desc    Generate a reset code for a user
// @access  Private (Admin)
router.post('/reset-codes', [
  auth,
  adminAuth,
  body('email').isEmail().normalizeEmail().withMessage('Please enter a valid email')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { email } = req.body;

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

    // Expire any existing unused codes for this email
    await ResetCode.updateMany(
      { email, isUsed: false },
      { isUsed: true, usedAt: new Date() }
    );

    // Generate unique code
    let code;
    let isUnique = false;
    while (!isUnique) {
      code = generateResetCode();
      const existing = await ResetCode.findOne({ code, isUsed: false });
      if (!existing) isUnique = true;
    }

    const resetCode = new ResetCode({
      code,
      email,
      generatedBy: req.user._id
    });

    await resetCode.save();
    await resetCode.populate('generatedBy', 'name email');

    res.status(201).json({ 
      message: 'Reset code generated successfully',
      resetCode: {
        code: resetCode.code,
        email: resetCode.email,
        expiresAt: resetCode.expiresAt,
        generatedBy: resetCode.generatedBy
      }
    });
  } catch (error) {
    console.error('Generate reset code error:', error);
    res.status(500).json({ message: 'Server error while generating reset code' });
  }
});

// @route   DELETE /api/admin/reset-codes/:id
// @desc    Delete/expire a reset code
// @access  Private (Admin)
router.delete('/reset-codes/:id', auth, adminAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const resetCode = await ResetCode.findById(id);
    if (!resetCode) {
      return res.status(404).json({ message: 'Reset code not found' });
    }

    await ResetCode.findByIdAndDelete(id);

    res.json({ message: 'Reset code deleted successfully' });
  } catch (error) {
    console.error('Delete reset code error:', error);
    res.status(500).json({ message: 'Server error while deleting reset code' });
  }
});

// @route   GET /api/admin/user-tasks/:userId/date/:date
// @desc    Get task instances for a specific user and date (admin only)
// @access  Private (Admin)
router.get('/user-tasks/:userId/date/:date', auth, adminAuth, async (req, res) => {
  try {
    const { userId, date } = req.params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    // Verify user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Parse date components to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }

    // Find all tasks that should be active on this date for this user
    const activeTasks = await Task.find({
      userId,
      startDate: { $lte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999), $ne: null },
      endDate: { $gte: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0), $ne: null }
    }).populate('subtasks').sort({ order: 1, createdAt: -1 });

    // Get or create task instances
    const TaskInstance = require('../models/TaskInstance');
    const taskInstances = [];
    
    for (const task of activeTasks) {
      let instance = await TaskInstance.findOne({
        taskId: task._id,
        userId,
        date: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0)
      });

      if (!instance) {
        // Create instance if it doesn't exist
        const subtaskInstances = task.subtasks.map(subtask => ({
          subtaskId: subtask._id,
          completed: false
        }));

        instance = new TaskInstance({
          taskId: task._id,
          userId,
          date: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0),
          completed: false,
          subtaskInstances
        });

        await instance.save();
      }

      // Populate the task and subtask details
      await instance.populate([
        { path: 'taskId', select: 'title startDate endDate' },
        { path: 'subtaskInstances.subtaskId', select: 'title notes' }
      ]);
      
      taskInstances.push(instance);
    }

    res.json({ 
      taskInstances, 
      date,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Get user tasks error:', error);
    res.status(500).json({ message: 'Server error while fetching user tasks' });
  }
});

module.exports = router;