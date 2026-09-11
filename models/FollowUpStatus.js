const mongoose = require('mongoose');

// Tracks completion + note for each follow-up entry on a specific date
// entryType: 'outreach' | 'lead'
// entryId: the _id of the outreach subdoc or the Lead._id
// date: the follow-up date (calendar date)

const followUpStatusSchema = new mongoose.Schema({
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  entryType: {
    type: String,
    enum: ['outreach', 'lead'],
    required: true
  },
  entryId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  date: {
    type: Date,
    required: true
  },
  completed: {
    type: Boolean,
    default: false
  },
  note: {
    type: String,
    trim: true,
    maxlength: 500,
    default: ''
  }
}, { timestamps: true });

// One status per admin per entry per date
followUpStatusSchema.index({ adminId: 1, entryId: 1, date: 1 }, { unique: true });

module.exports = mongoose.model('FollowUpStatus', followUpStatusSchema);
