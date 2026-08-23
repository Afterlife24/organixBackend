const mongoose = require('mongoose');

const personMetSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  role: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },
  hasFollowUp: {
    type: Boolean,
    default: false
  },
  followUpNote: {
    type: String,
    trim: true,
    maxlength: 300,
    default: ''
  }
}, { _id: true });

const leadSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  status: {
    type: String,
    enum: ['new', 'warm', 'hot'],
    default: 'new'
  },
  followUp: {
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
  peopleMet: [personMetSchema],
  leads: [leadSchema],
  notes: {
    type: String,
    trim: true,
    maxlength: 2000,
    default: ''
  }
}, {
  timestamps: true
});

// One log per admin per day
dailyLogSchema.index({ adminId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);
