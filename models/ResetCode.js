const mongoose = require('mongoose');

const resetCodeSchema = new mongoose.Schema({
  code: {
    type: String,
    required: true,
    unique: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now
  }
}, {
  timestamps: true
});

// Index for efficient queries
resetCodeSchema.index({ code: 1, isUsed: 1 });
resetCodeSchema.index({ email: 1, isUsed: 1 });
resetCodeSchema.index({ expiresAt: 1 });

module.exports = mongoose.model('ResetCode', resetCodeSchema);
