const mongoose = require('mongoose');

const taskInstanceSchema = new mongoose.Schema({
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  subtaskInstances: [{
    subtaskId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subtask',
      required: true
    },
    completed: {
      type: Boolean,
      default: false
    }
  }]
}, {
  timestamps: true
});

// Compound index to ensure one instance per task per day per user
taskInstanceSchema.index({ taskId: 1, userId: 1, date: 1 }, { unique: true });

// Index for efficient queries
taskInstanceSchema.index({ userId: 1, date: 1 });

module.exports = mongoose.model('TaskInstance', taskInstanceSchema);