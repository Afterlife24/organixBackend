const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  // who owns this lead
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // basic info
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  company: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },
  contact: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },
  phone: {
    type: String,
    trim: true,
    maxlength: 20,
    default: ''
  },
  email: {
    type: String,
    trim: true,
    maxlength: 100,
    default: ''
  },

  // pipeline stage
  stage: {
    type: String,
    enum: ['lead', 'conversation', 'meeting', 'proposal', 'client', 'lost'],
    default: 'lead'
  },

  // what service they are interested in
  serviceInterest: {
    type: String,
    enum: ['website', 'ai-audit', 'linkedin', 'automation', 'other'],
    default: 'other'
  },

  // channel through which they were first reached
  source: {
    type: String,
    enum: ['cold-call', 'linkedin', 'whatsapp', 'event', 'referral', 'other'],
    default: 'cold-call'
  },

  // next action to take
  nextStep: {
    type: String,
    trim: true,
    maxlength: 300,
    default: ''
  },

  // date for the next follow-up — drives calendar display
  followUpDate: {
    type: Date,
    default: null
  },

  // date the lead was first added
  firstContactDate: {
    type: Date,
    default: () => new Date()
  },

  // is this lead archived (won/lost and done)
  isArchived: {
    type: Boolean,
    default: false
  },

  notes: {
    type: String,
    trim: true,
    maxlength: 1000,
    default: ''
  }
}, {
  timestamps: true
});

leadSchema.index({ ownerId: 1, stage: 1 });
leadSchema.index({ ownerId: 1, createdAt: -1 });

module.exports = mongoose.model('Lead', leadSchema);
