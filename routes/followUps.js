const express = require('express');
const Lead = require('../models/Lead');
const DailyLog = require('../models/DailyLog');
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

// @route   GET /api/follow-ups/month/:year/:month
// @desc    Per-day counts: { "2026-09-01": { outreach: 1, leads: 0 }, ... }
//          Outreach dots appear on followUpDate (not log date)
//          Lead dots appear on followUpDate
router.get('/month/:year/:month', auth, adminAuth, async (req, res) => {
  try {
    const year  = parseInt(req.params.year);
    const month = parseInt(req.params.month);

    const startDate = utcMidnight(year, month - 1, 1);
    const endDate   = utcMidnight(year, month,     1); // exclusive

    // Lead follow-ups due this month
    const leads = await Lead.find({
      followUpDate: { $gte: startDate, $lt: endDate },
      isArchived: false,
      stage: { $nin: ['client', 'lost'] },
    }).select('followUpDate');

    // All daily logs this month that have any follow-up outreach entries
    // We look at outreach.followUpDate (the actual follow-up date), not log.date
    const logs = await DailyLog.find({}).select('outreach');

    const counts = {};

    // Lead dots
    leads.forEach(lead => {
      if (!lead.followUpDate) return;
      const key = toDateStr(lead.followUpDate);
      if (!counts[key]) counts[key] = { outreach: 0, leads: 0 };
      counts[key].leads += 1;
    });

    // Outreach dots — keyed by outreach.followUpDate (the day the follow-up should happen)
    logs.forEach(log => {
      (log.outreach || []).forEach(entry => {
        if (entry.outcome !== 'follow-up' || !entry.followUpDate) return;
        const fud = new Date(entry.followUpDate);
        // only count if in this month
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
// @desc    Full follow-up details for YYYY-MM-DD
//          Shows outreach entries whose followUpDate = this date
//          Shows leads whose followUpDate = this date
router.get('/date/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const parsedDate = parseDateUTC(date);
    const nextDay    = new Date(parsedDate.getTime() + 24 * 60 * 60 * 1000);

    // Lead follow-ups on this exact date
    const leads = await Lead.find({
      followUpDate: { $gte: parsedDate, $lt: nextDay },
      isArchived: false,
      stage: { $nin: ['client', 'lost'] },
    }).populate('ownerId', 'name email');

    // Outreach entries with followUpDate = this date (across ALL logs)
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

    res.json({ outreach: outreachFollowUps, leads, date });
  } catch (err) {
    console.error('Follow-ups date error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
