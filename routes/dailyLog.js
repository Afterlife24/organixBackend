const express = require('express');
const { body, validationResult } = require('express-validator');
const DailyLog = require('../models/DailyLog');
const LeadActivity = require('../models/LeadActivity');
const User = require('../models/User');
const auth = require('../middleware/auth');

const router = express.Router();

const adminAuth = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};

const parseDate = (dateStr) => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const getOrCreateLog = async (adminId, dateStr) => {
  const date = parseDate(dateStr);
  let log = await DailyLog.findOne({ adminId, date });
  if (!log) {
    log = new DailyLog({ adminId, date });
    await log.save();
  }
  return log;
};

// @route   GET /api/daily-log/team/:date
// @desc    All admins' logs + their lead activities for a date (team view)
// NOTE: this route must come before /:date to avoid conflict
router.get('/team/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Invalid date format' });

    const parsedDate = parseDate(date);
    const admins = await User.find({ isAdmin: true }).select('_id name email');
    const logs = await DailyLog.find({ date: parsedDate }).populate('adminId', 'name email');
    const activities = await LeadActivity.find({ date: parsedDate })
      .populate('leadId', 'name company stage serviceInterest')
      .populate('adminId', 'name email');

    const logMap = {};
    logs.forEach(l => { if (l.adminId) logMap[l.adminId._id.toString()] = l; });

    const activityMap = {};
    activities.forEach(a => {
      const key = a.adminId._id.toString();
      if (!activityMap[key]) activityMap[key] = [];
      activityMap[key].push(a);
    });

    const teamLogs = admins.map(admin => ({
      admin: { _id: admin._id, name: admin.name, email: admin.email },
      log: logMap[admin._id.toString()] || null,
      leadActivities: activityMap[admin._id.toString()] || [],
    }));

    res.json({ teamLogs, date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/daily-log/:date
// @desc    Get my log for a date + my lead activities for that date
router.get('/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Invalid date format' });

    const log = await getOrCreateLog(req.user._id, date);

    // also return lead activities for this date so daily log shows full picture
    const leadActivities = await LeadActivity.find({
      adminId: req.user._id,
      date: parseDate(date)
    }).populate('leadId', 'name company stage serviceInterest').sort({ createdAt: -1 });

    res.json({ log, leadActivities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/daily-log/:date/station
router.patch('/:date/station', [
  auth, adminAuth,
  body('station').trim().isLength({ max: 100 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const log = await getOrCreateLog(req.user._id, req.params.date);
    log.station = req.body.station;
    await log.save();
    res.json({ log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/daily-log/:date/summary
// @desc    Update wins, blockers, notes
router.patch('/:date/summary', [
  auth, adminAuth,
  body('wins').optional().trim().isLength({ max: 1000 }),
  body('blockers').optional().trim().isLength({ max: 1000 }),
  body('notes').optional().trim().isLength({ max: 2000 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const { wins, blockers, notes } = req.body;
    const log = await getOrCreateLog(req.user._id, req.params.date);
    if (wins !== undefined) log.wins = wins;
    if (blockers !== undefined) log.blockers = blockers;
    if (notes !== undefined) log.notes = notes;
    await log.save();
    res.json({ log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── OUTREACH (cold contacts, not yet leads) ─────────────────────────────────

// @route   POST /api/daily-log/:date/outreach
router.post('/:date/outreach', [
  auth, adminAuth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name required'),
  body('phone').optional().trim().isLength({ max: 20 }),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email'),
  body('channel').optional().isIn(['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other']),
  body('outcome').optional().isIn(['interested', 'follow-up', 'not-interested', 'no-response']),
  body('followUpNote').optional().trim().isLength({ max: 300 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const { name, phone, email, channel, outcome, followUpNote } = req.body;
    const log = await getOrCreateLog(req.user._id, req.params.date);
    log.outreach.push({
      name,
      phone: phone || '',
      email: email || '',
      channel: channel || 'cold-call',
      outcome: outcome || 'no-response',
      followUpNote: outcome === 'follow-up' ? (followUpNote || '') : '',
    });
    await log.save();
    res.status(201).json({ log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/daily-log/:date/outreach/:entryId
// @desc    Remove an outreach entry — supports adminId query param for team view
router.delete('/:date/outreach/:entryId', auth, adminAuth, async (req, res) => {
  try {
    // if adminId query param provided, act on that admin's log (team view edit)
    const targetAdminId = req.query.adminId || req.user._id;
    const log = await getOrCreateLog(targetAdminId, req.params.date);
    log.outreach = log.outreach.filter(o => o._id.toString() !== req.params.entryId);
    await log.save();
    res.json({ log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/daily-log/:date/outreach/:entryId
// @desc    Update an outreach entry — supports adminId body param for team view edit
router.patch('/:date/outreach/:entryId', [
  auth, adminAuth,
  body('channel').optional().isIn(['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other']),
  body('outcome').optional().isIn(['interested', 'follow-up', 'not-interested', 'no-response']),
  body('followUpNote').optional().trim().isLength({ max: 300 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const targetAdminId = req.body.adminId || req.user._id;
    const log = await getOrCreateLog(targetAdminId, req.params.date);
    const entry = log.outreach.id(req.params.entryId);
    if (!entry) return res.status(404).json({ message: 'Outreach entry not found' });

    if (req.body.channel) entry.channel = req.body.channel;
    if (req.body.outcome) entry.outcome = req.body.outcome;
    if (req.body.followUpNote !== undefined) entry.followUpNote = req.body.followUpNote;

    await log.save();
    res.json({ log });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
