const express = require('express');
const User = require('../models/User');
const DailyLog = require('../models/DailyLog');
const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const FollowUpStatus = require('../models/FollowUpStatus');
const auth = require('../middleware/auth');

const router = express.Router();

const adminAuth = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};

const utcMidnight = (y, m, d) => new Date(Date.UTC(y, m, d, 0, 0, 0, 0));

const toDateStr = (d) => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Build a single day's summary from a DailyLog document
const buildDaySummary = (log) => {
  if (!log) return null;

  const outreach = log.outreach || [];
  const outreachByOutcome = {
    interested:      outreach.filter(o => o.outcome === 'interested').length,
    'follow-up':     outreach.filter(o => o.outcome === 'follow-up').length,
    'not-interested':outreach.filter(o => o.outcome === 'not-interested').length,
    'no-response':   outreach.filter(o => o.outcome === 'no-response').length,
  };
  const outreachByChannel = {};
  outreach.forEach(o => {
    outreachByChannel[o.channel] = (outreachByChannel[o.channel] || 0) + 1;
  });

  return {
    date: toDateStr(log.date),
    station: log.station || '',
    outreachTotal: outreach.length,
    outreachByOutcome,
    outreachByChannel,
    outreachEntries: outreach.map(o => ({
      name: o.name,
      channel: o.channel,
      outcome: o.outcome,
      followUpNote: o.followUpNote || '',
      notes: o.notes || '',
      phone: o.phone || '',
      email: o.email || '',
    })),
    wins: log.wins || '',
    blockers: log.blockers || '',
    notes: log.notes || '',
    taskNotes: log.taskNotes || '',
  };
};

// @route   GET /api/reports/admins
// @desc    Get all admin users (for dropdown)
router.get('/admins', auth, adminAuth, async (req, res) => {
  try {
    const admins = await User.find({ isAdmin: true }).select('_id name email');
    res.json({ admins });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/reports/weekly/:adminId/:startDate
// @desc    Weekly report for an admin starting from startDate (YYYY-MM-DD, Monday)
//          Returns 6 days Mon–Sat
router.get('/weekly/:adminId/:startDate', auth, adminAuth, async (req, res) => {
  try {
    const { adminId, startDate } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }

    const [y, m, d] = startDate.split('-').map(Number);
    const weekStart = utcMidnight(y, m - 1, d);
    const weekEnd   = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000); // Sun (7 days)
    const nextWeek  = new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

    const admin = await User.findById(adminId).select('name email');
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    // Fetch all logs in the week range
    const logs = await DailyLog.find({
      adminId,
      date: { $gte: weekStart, $lt: nextWeek },
    }).sort({ date: 1 });

    const logMap = {};
    logs.forEach(l => { logMap[toDateStr(l.date)] = l; });

    // Per-day leads added
    const allLeadsThisWeek = await Lead.find({
      ownerId: adminId,
      createdAt: { $gte: weekStart, $lt: nextWeek },
    }).select('name company stage serviceInterest source createdAt');

    // Per-day lead activities (stage changes + manual)
    const allActivities = await LeadActivity.find({
      adminId,
      date: { $gte: weekStart, $lt: nextWeek },
    }).populate('leadId', 'name company').sort({ date: 1 });

    // Group leads and activities by date string
    const leadsByDay = {};
    const activitiesByDay = {};
    allLeadsThisWeek.forEach(l => {
      const ds = toDateStr(l.createdAt);
      if (!leadsByDay[ds]) leadsByDay[ds] = [];
      leadsByDay[ds].push({ name: l.name, company: l.company, stage: l.stage, serviceInterest: l.serviceInterest });
    });
    allActivities.forEach(a => {
      const ds = toDateStr(a.date);
      if (!activitiesByDay[ds]) activitiesByDay[ds] = [];
      activitiesByDay[ds].push({
        leadName: a.leadId?.name || 'Unknown',
        company: a.leadId?.company || '',
        stageAfter: a.stageAfter,
        note: a.note || '',
        isSystemLog: a.isSystemLog,
      });
    });

    // Build day-by-day breakdown (7 days Mon–Sun)
    const days = [];
    for (let i = 0; i < 7; i++) {
      const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
      const ds = toDateStr(dayDate);
      const log = logMap[ds] || null;
      const dayName = DAY_NAMES[dayDate.getUTCDay()];
      const daySummary = buildDaySummary(log) || {
        date: ds, station: '', outreachTotal: 0,
        outreachByOutcome: { interested: 0, 'follow-up': 0, 'not-interested': 0, 'no-response': 0 },
        outreachByChannel: {}, outreachEntries: [],
        wins: '', blockers: '', notes: '', taskNotes: '',
      };
      days.push({
        dayName,
        ...daySummary,
        leadsAdded: leadsByDay[ds] || [],
        leadActivities: activitiesByDay[ds] || [],
      });
    }

    // Week-level aggregates
    const leadsAdded = allLeadsThisWeek;
    const stageChanges = allActivities.filter(a => a.stageAfter && a.stageAfter !== '');
    const stageChangesFormatted = stageChanges.map(sc => ({
      leadName: sc.leadId?.name || 'Unknown',
      company: sc.leadId?.company || '',
      stage: sc.stageAfter,
      date: toDateStr(sc.date),
      note: sc.note || '',
    }));

    // Follow-up completion this week
    const followUpStatuses = await FollowUpStatus.find({
      adminId,
      date: { $gte: weekStart, $lte: weekEnd },
    });
    const fuCompleted = followUpStatuses.filter(s => s.completed).length;
    const fuTotal = followUpStatuses.length;

    // Aggregated totals
    const totals = {
      outreachTotal: days.reduce((a, d) => a + d.outreachTotal, 0),
      interested:    days.reduce((a, d) => a + (d.outreachByOutcome?.interested || 0), 0),
      followUp:      days.reduce((a, d) => a + (d.outreachByOutcome?.['follow-up'] || 0), 0),
      notInterested: days.reduce((a, d) => a + (d.outreachByOutcome?.['not-interested'] || 0), 0),
      noResponse:    days.reduce((a, d) => a + (d.outreachByOutcome?.['no-response'] || 0), 0),
      leadsAdded:    leadsAdded.length,
      stageChanges:  stageChanges.length,
      fuCompleted,
      fuTotal,
    };

    res.json({
      admin: { _id: admin._id, name: admin.name, email: admin.email },
      weekStart: toDateStr(weekStart),
      weekEnd:   toDateStr(weekEnd),
      days,
      leadsAdded,
      stageChanges: stageChangesFormatted,
      totals,
    });
  } catch (err) {
    console.error('Weekly report error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/reports/monthly/:adminId/:year/:month
// @desc    Monthly report = 4 weekly reports combined
router.get('/monthly/:adminId/:year/:month', auth, adminAuth, async (req, res) => {
  try {
    const { adminId, year, month } = req.params;
    const y = parseInt(year);
    const m = parseInt(month);

    const admin = await User.findById(adminId).select('name email');
    if (!admin) return res.status(404).json({ message: 'Admin not found' });

    const monthStart = utcMidnight(y, m - 1, 1);
    const monthEnd   = utcMidnight(y, m, 1); // exclusive

    // All logs this month
    const logs = await DailyLog.find({
      adminId,
      date: { $gte: monthStart, $lt: monthEnd },
    }).sort({ date: 1 });

    const logMap = {};
    logs.forEach(l => { logMap[toDateStr(l.date)] = l; });

    // Group by week (Mon–Sat, up to 4 weeks)
    // Find first Monday on or after monthStart
    const weeks = [];
    let cursor = new Date(monthStart);
    // advance to Monday
    while (cursor.getUTCDay() !== 1) {
      cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    }

    for (let w = 0; w < 4; w++) {
      const weekStart = new Date(cursor);
      const weekDays = [];
      for (let i = 0; i < 7; i++) {  // Mon–Sun
        const dayDate = new Date(weekStart.getTime() + i * 24 * 60 * 60 * 1000);
        if (dayDate >= monthEnd) break;
        const ds = toDateStr(dayDate);
        const log = logMap[ds] || null;
        const dayName = DAY_NAMES[dayDate.getUTCDay()];
        weekDays.push({
          dayName,
          ...buildDaySummary(log) || {
            date: ds, station: '', outreachTotal: 0,
            outreachByOutcome: { interested: 0, 'follow-up': 0, 'not-interested': 0, 'no-response': 0 },
            outreachByChannel: {}, outreachEntries: [],
            wins: '', blockers: '', notes: '', taskNotes: '',
          },
        });
      }
      if (weekDays.length > 0) {
        weeks.push({
          weekNumber: w + 1,
          weekStart: toDateStr(weekStart),
          weekEnd:   toDateStr(new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)), // Sunday
          days: weekDays,
          totals: {
            outreachTotal: weekDays.reduce((a, d) => a + d.outreachTotal, 0),
            interested:    weekDays.reduce((a, d) => a + (d.outreachByOutcome?.interested || 0), 0),
            followUp:      weekDays.reduce((a, d) => a + (d.outreachByOutcome?.['follow-up'] || 0), 0),
            notInterested: weekDays.reduce((a, d) => a + (d.outreachByOutcome?.['not-interested'] || 0), 0),
            noResponse:    weekDays.reduce((a, d) => a + (d.outreachByOutcome?.['no-response'] || 0), 0),
          },
        });
      }
      cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    }

    // Monthly totals
    const allDays = weeks.flatMap(w => w.days);
    const leadsAdded = await Lead.find({
      ownerId: adminId,
      createdAt: { $gte: monthStart, $lt: monthEnd },
    }).select('name company stage serviceInterest source createdAt');

    const monthTotals = {
      outreachTotal: allDays.reduce((a, d) => a + d.outreachTotal, 0),
      interested:    allDays.reduce((a, d) => a + (d.outreachByOutcome?.interested || 0), 0),
      followUp:      allDays.reduce((a, d) => a + (d.outreachByOutcome?.['follow-up'] || 0), 0),
      notInterested: allDays.reduce((a, d) => a + (d.outreachByOutcome?.['not-interested'] || 0), 0),
      noResponse:    allDays.reduce((a, d) => a + (d.outreachByOutcome?.['no-response'] || 0), 0),
      leadsAdded:    leadsAdded.length,
    };

    res.json({
      admin: { _id: admin._id, name: admin.name, email: admin.email },
      year: y, month: m,
      weeks,
      leadsAdded,
      monthTotals,
    });
  } catch (err) {
    console.error('Monthly report error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
