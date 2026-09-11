const express = require('express');
const { body, validationResult } = require('express-validator');
const Lead = require('../models/Lead');
const DailyLog = require('../models/DailyLog');
const FollowUpStatus = require('../models/FollowUpStatus');
const auth = require('../middleware/auth');

const router = express.Router();

const adminAuth = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};

const utcMidnight = (y, m, d) => new Date(Date.UTC(y, m, d, 0, 0, 0, 0));

const parseDateUTC = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return utcMidnight(y, m - 1, d);
};

const toDateStr = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

// helper: build status map { entryId: { completed, note } }
const buildStatusMap = (statuses) => {
  const map = {};
  statuses.forEach(s => { map[s.entryId.toString()] = { completed: s.completed, note: s.note, _id: s._id }; });
  return map;
};

// @route   GET /api/follow-ups/month/:year/:month
router.get('/month/:year/:month', auth, adminAuth, async (req, res) => {
  try {
    const year  = parseInt(req.params.year);
    const month = parseInt(req.params.month);
    const startDate = utcMidnight(year, month - 1, 1);
    const endDate   = utcMidnight(year, month, 1);

    const leads = await Lead.find({
      followUpDate: { $gte: startDate, $lt: endDate },
      isArchived: false,
      stage: { $nin: ['client', 'lost'] },
    }).select('followUpDate');

    const logs = await DailyLog.find({}).select('outreach');

    const counts = {};

    leads.forEach(lead => {
      if (!lead.followUpDate) return;
      const key = toDateStr(lead.followUpDate);
      if (!counts[key]) counts[key] = { outreach: 0, leads: 0 };
      counts[key].leads += 1;
    });

    logs.forEach(log => {
      (log.outreach || []).forEach(entry => {
        if (entry.outcome !== 'follow-up' || !entry.followUpDate) return;
        const fud = new Date(entry.followUpDate);
        if (fud < startDate || fud >= endDate) return;
        const key = toDateStr(fud);
        if (!counts[key]) counts[key] = { outreach: 0, leads: 0 };
        counts[key].outreach += 1;
      });
    });

    res.json({ counts, year, month });
  } catch (err) {
    console.error('Follow-ups month count error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/follow-ups/date/:date
// Returns outreach + lead follow-ups with status (completed, note) merged in
router.get('/date/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const parsedDate = parseDateUTC(date);
    const nextDay    = new Date(parsedDate.getTime() + 24 * 60 * 60 * 1000);

    // Lead follow-ups
    const leads = await Lead.find({
      followUpDate: { $gte: parsedDate, $lt: nextDay },
      isArchived: false,
      stage: { $nin: ['client', 'lost'] },
    }).populate('ownerId', 'name email');

    // Outreach follow-ups
    const logs = await DailyLog.find({
      'outreach.followUpDate': { $gte: parsedDate, $lt: nextDay },
    }).populate('adminId', 'name email');

    const outreachFollowUps = [];
    logs.forEach(log => {
      const entries = (log.outreach || []).filter(o => {
        if (o.outcome !== 'follow-up' || !o.followUpDate) return false;
        const fud = new Date(o.followUpDate);
        return fud >= parsedDate && fud < nextDay;
      });
      entries.forEach(entry => {
        outreachFollowUps.push({
          ...entry.toObject(),
          loggedBy: log.adminId,
          logDate: log.date,
        });
      });
    });

    // Fetch status records for this admin on this date
    const allIds = [
      ...outreachFollowUps.map(o => o._id),
      ...leads.map(l => l._id),
    ];
    const statuses = await FollowUpStatus.find({
      adminId: req.user._id,
      entryId: { $in: allIds },
      date: { $gte: parsedDate, $lt: nextDay },
    });
    const statusMap = buildStatusMap(statuses);

    // Merge status into each entry
    const outreachWithStatus = outreachFollowUps.map(o => ({
      ...o,
      status: statusMap[o._id.toString()] || { completed: false, note: '' },
    }));
    const leadsWithStatus = leads.map(l => ({
      ...l.toObject(),
      status: statusMap[l._id.toString()] || { completed: false, note: '' },
    }));

    res.json({ outreach: outreachWithStatus, leads: leadsWithStatus, date });
  } catch (err) {
    console.error('Follow-ups date error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/follow-ups/status
// @desc    Toggle completed or update note for a follow-up entry
router.patch('/status', [
  auth, adminAuth,
  body('entryId').notEmpty().withMessage('entryId required'),
  body('entryType').isIn(['outreach', 'lead']).withMessage('entryType must be outreach or lead'),
  body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('date required YYYY-MM-DD'),
  body('completed').optional().isBoolean(),
  body('note').optional().trim().isLength({ max: 500 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const { entryId, entryType, date, completed, note } = req.body;
    const parsedDate = parseDateUTC(date);

    // upsert — create if not exists, update if exists
    const update = {};
    if (completed !== undefined) update.completed = completed;
    if (note !== undefined) update.note = note;

    const status = await FollowUpStatus.findOneAndUpdate(
      { adminId: req.user._id, entryId, date: parsedDate },
      { $set: { ...update, entryType } },
      { upsert: true, new: true }
    );

    res.json({ status });
  } catch (err) {
    console.error('Follow-up status update error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
