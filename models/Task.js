const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Task title is required'],
    trim: true,
    maxlength: [200, 'Task title cannot exceed 200 characters']
  },
  completed: {
    type: Boolean,
    default: false
  },
  order: {
    type: Number,
    default: 0
  },
  startDate: {
    type: Date,
    required: false, // Made optional for static tasks
    default: null
  },
  endDate: {
    type: Date,
    required: false, // Made optional for static tasks
    default: null,
    validate: {
      validator: function(value) {
        // Only validate if both dates are provided
        if (this.startDate && value) {
          return value >= this.startDate;
        }
        return true;
      },
      message: 'End date must be after or equal to start date'
    }
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false // Optional field to track if task was created by admin
  },
  subtasks: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subtask'
  }]
}, {
  timestamps: true
});

// Index for efficient queries
taskSchema.index({ userId: 1, startDate: 1, endDate: 1 });

// Virtual to check if task is active for a given date
taskSchema.methods.isActiveOnDate = function(date) {
  // If no dates are set, it's a static task (not date-based)
  if (!this.startDate || !this.endDate) {
    return false;
  }
  
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  const start = new Date(this.startDate);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(this.endDate);
  end.setHours(23, 59, 59, 999);
  
  return checkDate >= start && checkDate <= end;
};

// Static method to find tasks for a specific date
taskSchema.statics.findTasksForDate = function(userId, date) {
  // Parse date string to avoid timezone issues
  let targetDate;
  if (typeof date === 'string') {
    const [year, month, day] = date.split('-').map(Number);
    targetDate = new Date(year, month - 1, day);
  } else {
    targetDate = new Date(date);
  }
  
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);
  
  console.log('Task Model: Finding tasks for user:', userId, 'date range:', startOfDay, 'to', endOfDay);
  
  const query = {
    userId,
    startDate: { $lte: endOfDay, $ne: null },
    endDate: { $gte: startOfDay, $ne: null }
  };
  
  console.log('Task Model: Query:', JSON.stringify(query, null, 2));
  
  return this.find(query).populate('subtasks').sort({ order: 1, createdAt: -1 }); // Sort by order first, then by newest
};

module.exports = mongoose.model('Task', taskSchema);