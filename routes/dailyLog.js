const express = require('express');
const { body, validationResult } = require('express-validator');
const DailyLog = require('../models/DailyLog');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

// Middleware to check admin
const adminAuth = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ message: 'Admin access required.' });
  }
  next();
};

// Helper: parse date string to local midnight Date object
const parseDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

// Helper: get or create log for a date
const getOrCreateLog = async (adminId, dateStr) => {
  const date = parseDate(dateStr);
  let log = await DailyLog.findOne({ adminId, date });
  if (!log) {
    log = new DailyLog({ adminId, date });
    await log.save();
  }
  return log;
};

// @route   GET /api/daily-log/:date
// @desc    Get log for a specific date (YYYY-MM-DD), creates empty one if not exists
// @access  Private (Admin)
router.get('/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    const log = await getOrCreateLog(req.user._id, date);
    res.json({ log });
  } catch (error) {
    console.error('Get daily log error:', error);
    res.status(500).json({ message: 'Server error while fetching daily log' });
  }
});

// @route   GET /api/daily-log/team/:date
// @desc    Get all admins' logs for a date (read-only team view)
// @access  Private (Admin)
router.get('/team/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const parsedDate = parseDate(date);

    // Get all admin users
    const admins = await User.find({ isAdmin: true }).select('_id name email');

    // Get all logs for this date across all admins
    const logs = await DailyLog.find({ date: parsedDate })
      .populate('adminId', 'name email');

    // Build a map for quick lookup
    const logMap = {};
    logs.forEach(l => {
      if (l.adminId) logMap[l.adminId._id.toString()] = l;
    });

    // Return one entry per admin, even if they have no log yet
    const teamLogs = admins.map(admin => ({
      admin: { _id: admin._id, name: admin.name, email: admin.email },
      log: logMap[admin._id.toString()] || null
    }));

    res.json({ teamLogs, date });
  } catch (error) {
    console.error('Get team logs error:', error);
    res.status(500).json({ message: 'Server error while fetching team logs' });
  }
});

// @route   PATCH /api/daily-log/:date/station
// @desc    Update station name for a date
// @access  Private (Admin)
router.patch('/:date/station', [
  auth,
  adminAuth,
  body('station').trim().isLength({ max: 100 }).withMessage('Station name too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { date } = req.params;
    const { station } = req.body;
    const log = await getOrCreateLog(req.user._id, date);
    log.station = station;
    await log.save();
    res.json({ log });
  } catch (error) {
    console.error('Update station error:', error);
    res.status(500).json({ message: 'Server error while updating station' });
  }
});

// @route   PATCH /api/daily-log/:date/notes
// @desc    Update general notes for a date
// @access  Private (Admin)
router.patch('/:date/notes', [
  auth,
  adminAuth,
  body('notes').trim().isLength({ max: 2000 }).withMessage('Notes too long')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { date } = req.params;
    const { notes } = req.body;
    const log = await getOrCreateLog(req.user._id, date);
    log.notes = notes;
    await log.save();
    res.json({ log });
  } catch (error) {
    console.error('Update notes error:', error);
    res.status(500).json({ message: 'Server error while updating notes' });
  }
});

// ─── PEOPLE MET ─────────────────────────────────────────────────────────────

// @route   POST /api/daily-log/:date/people
// @desc    Add a person met entry
// @access  Private (Admin)
router.post('/:date/people', [
  auth,
  adminAuth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name is required'),
  body('role').optional().trim().isLength({ max: 100 }),
  body('hasFollowUp').optional().isBoolean(),
  body('followUpNote').optional().trim().isLength({ max: 300 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { date } = req.params;
    const { name, role, hasFollowUp, followUpNote } = req.body;
    const log = await getOrCreateLog(req.user._id, date);

    const person = {
      name,
      role: role || '',
      hasFollowUp: hasFollowUp || false,
      followUpNote: hasFollowUp ? (followUpNote || '') : ''
    };

    log.peopleMet.push(person);
    await log.save();

    const added = log.peopleMet[log.peopleMet.length - 1];
    res.status(201).json({ person: added, log });
  } catch (error) {
    console.error('Add person error:', error);
    res.status(500).json({ message: 'Server error while adding person' });
  }
});

// @route   DELETE /api/daily-log/:date/people/:personId
// @desc    Remove a person met entry
// @access  Private (Admin)
router.delete('/:date/people/:personId', auth, adminAuth, async (req, res) => {
  try {
    const { date, personId } = req.params;
    const log = await getOrCreateLog(req.user._id, date);
    log.peopleMet = log.peopleMet.filter(p => p._id.toString() !== personId);
    await log.save();
    res.json({ log });
  } catch (error) {
    console.error('Delete person error:', error);
    res.status(500).json({ message: 'Server error while deleting person' });
  }
});

// ─── LEADS ──────────────────────────────────────────────────────────────────

// @route   POST /api/daily-log/:date/leads
// @desc    Add a lead entry
// @access  Private (Admin)
router.post('/:date/leads', [
  auth,
  adminAuth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Lead name is required'),
  body('status').isIn(['new', 'warm', 'hot']).withMessage('Status must be new, warm, or hot'),
  body('followUp').optional().trim().isLength({ max: 300 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }
    const { date } = req.params;
    const { name, status, followUp } = req.body;
    const log = await getOrCreateLog(req.user._id, date);

    log.leads.push({ name, status, followUp: followUp || '' });
    await log.save();

    const added = log.leads[log.leads.length - 1];
    res.status(201).json({ lead: added, log });
  } catch (error) {
    console.error('Add lead error:', error);
    res.status(500).json({ message: 'Server error while adding lead' });
  }
});

// @route   DELETE /api/daily-log/:date/leads/:leadId
// @desc    Remove a lead entry
// @access  Private (Admin)
router.delete('/:date/leads/:leadId', auth, adminAuth, async (req, res) => {
  try {
    const { date, leadId } = req.params;
    const log = await getOrCreateLog(req.user._id, date);
    log.leads = log.leads.filter(l => l._id.toString() !== leadId);
    await log.save();
    res.json({ log });
  } catch (error) {
    console.error('Delete lead error:', error);
    res.status(500).json({ message: 'Server error while deleting lead' });
  }
});

module.exports = router;
