const express = require('express');
const { body, validationResult } = require('express-validator');
const Lead = require('../models/Lead');
const LeadActivity = require('../models/LeadActivity');
const auth = require('../middleware/auth');

const router = express.Router();

const adminAuth = (req, res, next) => {
  if (!req.user.isAdmin) return res.status(403).json({ message: 'Admin access required.' });
  next();
};

const parseDate = (dateStr) => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
};

// ─── LEADS CRUD ──────────────────────────────────────────────────────────────

// @route   GET /api/leads
// @desc    Get all leads for current admin (optionally filter by stage/archived)
router.get('/', auth, adminAuth, async (req, res) => {
  try {
    const { stage, archived, search } = req.query;
    const filter = { ownerId: req.user._id };

    if (stage) filter.stage = stage;
    filter.isArchived = archived === 'true' ? true : false;
    if (search) filter.name = { $regex: search, $options: 'i' };

    const leads = await Lead.find(filter).sort({ updatedAt: -1 });
    res.json({ leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/all-admins
// @desc    Get all leads across all admins (for team pipeline view)
router.get('/all-admins', auth, adminAuth, async (req, res) => {
  try {
    const leads = await Lead.find({ isArchived: false })
      .populate('ownerId', 'name email')
      .sort({ updatedAt: -1 });
    res.json({ leads });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/pipeline-counts
// @desc    Get count per stage for current admin
router.get('/pipeline-counts', auth, adminAuth, async (req, res) => {
  try {
    const counts = await Lead.aggregate([
      { $match: { ownerId: req.user._id, isArchived: false } },
      { $group: { _id: '$stage', count: { $sum: 1 } } }
    ]);
    const result = { lead: 0, conversation: 0, meeting: 0, proposal: 0, client: 0, lost: 0 };
    counts.forEach(c => { result[c._id] = c.count; });
    res.json({ counts: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ─── LEAD ACTIVITIES ─────────────────────────────────────────────────────────

// @route   GET /api/leads/activities/date/:date
// NOTE: must be defined BEFORE /:id to avoid Express treating 'activities' as an id
router.get('/activities/date/:date', auth, adminAuth, async (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ message: 'Invalid date format' });

    const parsedDate = parseDate(date);
    const activities = await LeadActivity.find({ adminId: req.user._id, date: parsedDate })
      .populate('leadId', 'name company stage serviceInterest')
      .sort({ createdAt: -1 });

    res.json({ activities, date });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/activities/:activityId
// NOTE: must be defined BEFORE /:id
router.delete('/activities/:activityId', auth, adminAuth, async (req, res) => {
  try {
    const activity = await LeadActivity.findOne({ _id: req.params.activityId, adminId: req.user._id });
    if (!activity) return res.status(404).json({ message: 'Activity not found' });
    await activity.deleteOne();
    res.json({ message: 'Activity deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   GET /api/leads/:id
// @desc    Get single lead with full activity history
router.get('/:id', auth, adminAuth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id).populate('ownerId', 'name email');
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const activities = await LeadActivity.find({ leadId: lead._id })
      .populate('adminId', 'name email')
      .sort({ date: -1, createdAt: -1 });

    res.json({ lead, activities });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads
// @desc    Create a new lead
router.post('/', [
  auth, adminAuth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Name required'),
  body('company').optional().trim().isLength({ max: 100 }),
  body('contact').optional().trim().isLength({ max: 100 }),
  body('phone').optional().trim().isLength({ max: 20 }),
  body('email').optional({ values: 'falsy' }).trim().isEmail().withMessage('Invalid email'),
  body('stage').optional().isIn(['lead', 'conversation', 'meeting', 'proposal', 'client', 'lost']),
  body('serviceInterest').optional().isIn(['website', 'ai-audit', 'linkedin', 'automation', 'other']),
  body('source').optional().isIn(['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other']),
  body('nextStep').optional().trim().isLength({ max: 300 }),
  body('notes').optional().trim().isLength({ max: 1000 }),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const { name, company, contact, phone, email, stage, serviceInterest, source, nextStep, notes } = req.body;
    const lead = new Lead({
      ownerId: req.user._id,
      name,
      company: company || '',
      contact: contact || '',
      phone: phone || '',
      email: email || '',
      stage: stage || 'lead',
      serviceInterest: serviceInterest || 'other',
      source: source || 'cold-call',
      nextStep: nextStep || '',
      notes: notes || '',
      firstContactDate: new Date(),
    });
    await lead.save();
    res.status(201).json({ lead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   PATCH /api/leads/:id
// @desc    Update lead info or stage — any admin can update
router.patch('/:id', [
  auth, adminAuth,
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
  body('company').optional().trim().isLength({ max: 100 }),
  body('contact').optional().trim().isLength({ max: 100 }),
  body('phone').optional().trim().isLength({ max: 20 }),
  body('email').optional({ values: 'falsy' }).trim().isEmail(),
  body('stage').optional().isIn(['lead', 'conversation', 'meeting', 'proposal', 'client', 'lost']),
  body('serviceInterest').optional().isIn(['website', 'ai-audit', 'linkedin', 'automation', 'other']),
  body('source').optional().isIn(['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other']),
  body('nextStep').optional().trim().isLength({ max: 300 }),
  body('followUpDate').optional({ values: 'falsy' }).isISO8601().withMessage('Invalid date'),
  body('notes').optional().trim().isLength({ max: 1000 }),
  body('isArchived').optional().isBoolean(),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    // any admin can edit — no ownerId check
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    // track what changed for the history entry
    const changes = [];
    if (req.body.stage && req.body.stage !== lead.stage) changes.push(`Stage → ${req.body.stage}`);
    if (req.body.nextStep !== undefined && req.body.nextStep !== lead.nextStep) changes.push(`Next step updated`);
    if (req.body.notes !== undefined && req.body.notes !== lead.notes) changes.push(`Notes updated`);
    if (req.body.name && req.body.name !== lead.name) changes.push(`Name → ${req.body.name}`);
    if (req.body.company !== undefined && req.body.company !== lead.company) changes.push(`Company → ${req.body.company}`);
    if (req.body.contact !== undefined && req.body.contact !== lead.contact) changes.push(`Contact updated`);
    if (req.body.serviceInterest && req.body.serviceInterest !== lead.serviceInterest) changes.push(`Service → ${req.body.serviceInterest}`);

    const prevStage = lead.stage;
    const fields = ['name', 'company', 'contact', 'phone', 'email', 'stage', 'serviceInterest', 'source', 'nextStep', 'followUpDate', 'notes', 'isArchived'];
    fields.forEach(f => { if (req.body[f] !== undefined) lead[f] = req.body[f]; });

    await lead.save();

    // auto-log a LeadActivity history entry if something changed
    if (changes.length > 0) {
      const today = new Date();
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      await LeadActivity.create({
        leadId: lead._id,
        adminId: req.user._id,
        date,
        channel: 'other',
        outcome: lead.stage !== prevStage ? 'interested' : 'follow-up',
        note: changes.join(' · '),
        stageAfter: lead.stage !== prevStage ? lead.stage : '',
        isSystemLog: true,
      });
    }

    // re-populate ownerId for frontend
    await lead.populate('ownerId', 'name email');
    res.json({ lead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   DELETE /api/leads/:id
// @desc    Delete a lead — any admin can delete
router.delete('/:id', auth, adminAuth, async (req, res) => {
  try {
    const lead = await Lead.findById(req.params.id);
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    await LeadActivity.deleteMany({ leadId: lead._id });
    await lead.deleteOne();
    res.json({ message: 'Lead deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// @route   POST /api/leads/:id/activities
// @desc    Log an activity against a lead
router.post('/:id/activities', [
  auth, adminAuth,
  body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date required (YYYY-MM-DD)'),
  body('channel').isIn(['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'email', 'meeting', 'other']),
  body('outcome').isIn(['interested', 'follow-up', 'not-interested', 'no-response', 'meeting-set', 'proposal-sent', 'closed']),
  body('note').optional().trim().isLength({ max: 500 }),
  body('stageAfter').optional().isIn(['lead', 'conversation', 'meeting', 'proposal', 'client', 'lost', '']),
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: 'Validation failed', errors: errors.array() });

    const lead = await Lead.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!lead) return res.status(404).json({ message: 'Lead not found' });

    const { date, channel, outcome, note, stageAfter } = req.body;

    const activity = new LeadActivity({
      leadId: lead._id,
      adminId: req.user._id,
      date: parseDate(date),
      channel,
      outcome,
      note: note || '',
      stageAfter: stageAfter || '',
    });
    await activity.save();

    // if stageAfter provided, update the lead stage automatically
    if (stageAfter && stageAfter !== '') {
      lead.stage = stageAfter;
      await lead.save();
    }

    res.status(201).json({ activity, lead });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
