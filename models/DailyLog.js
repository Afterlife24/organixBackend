const mongoose = require('mongoose');

// Outreach = cold contacts made today (people who are NOT yet leads)
const outreachSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  channel: {
    type: String,
    enum: ['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other'],
    default: 'cold-call'
  },
  outcome: {
    type: String,
    enum: ['interested', 'follow-up', 'not-interested', 'no-response'],
    default: 'no-response'
  },
  followUpNote: {
    type: String,
    trim: true,
    maxlength: 300,
    default: ''
  }
}, { _id: true });

const dailyLogSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  station: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },
  outreach: [outreachSchema],
  wins: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  blockers: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  },
  notes: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: ''
  }
}, {
  timestamps: true
});

dailyLogSchema.index({ adminId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);
