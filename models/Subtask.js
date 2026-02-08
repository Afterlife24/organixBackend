const mongoose = require('mongoose');

const subtaskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Subtask title is required'],
    trim: true,
    maxlength: [150, 'Subtask title cannot exceed 150 characters']
  },
  completed: {
    type: Boolean,
    default: false
  },
  notes: {
    type: String,
    trim: true,
    maxlength: [500, 'Notes cannot exceed 500 characters']
  },
  taskId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Task',
    required: true
  }
}, {
  timestamps: true
});

// Index for efficient queries
subtaskSchema.index({ taskId: 1 });

module.exports = mongoose.model('Subtask', subtaskSchema);