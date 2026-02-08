const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const TaskInstance = require('../models/TaskInstance');
const Subtask = require('../models/Subtask');
const auth = require('../middleware/auth');

const router = express.Router();

// Helper function to get or create task instance for a specific date
const getOrCreateTaskInstance = async (taskId, userId, date) => {
  // Handle both string and Date object inputs
  let targetDate;
  if (typeof date === 'string') {
    // Parse the date string and create a proper date object in local timezone
    const [year, month, day] = date.split('-').map(Number);
    targetDate = new Date(year, month - 1, day);
  } else {
    // If it's already a Date object, use it directly
    targetDate = new Date(date);
  }
  targetDate.setHours(0, 0, 0, 0);

  let instance = await TaskInstance.findOne({
    taskId,
    userId,
    date: targetDate
  });

  // Get the task and its current subtasks
  const task = await Task.findById(taskId).populate('subtasks');
  if (!task) {
    throw new Error('Task not found');
  }

  if (!instance) {
    // Create new instance with all current subtasks
    const subtaskInstances = task.subtasks.map(subtask => ({
      subtaskId: subtask._id,
      completed: false
    }));

    instance = new TaskInstance({
      taskId,
      userId,
      date: targetDate,
      completed: false,
      subtaskInstances
    });

    await instance.save();
  } else {
    // Sync existing instance with current subtasks
    const currentSubtaskIds = new Set(task.subtasks.map(st => st._id.toString()));
    const instanceSubtaskIds = new Set(instance.subtaskInstances.map(si => si.subtaskId.toString()));
    
    let needsUpdate = false;
    
    // Add missing subtask instances
    for (const subtask of task.subtasks) {
      if (!instanceSubtaskIds.has(subtask._id.toString())) {
        instance.subtaskInstances.push({
          subtaskId: subtask._id,
          completed: false
        });
        needsUpdate = true;
        console.log(`Added missing subtask instance: ${subtask.title}`);
      }
    }
    
    // Remove subtask instances for deleted subtasks
    const originalLength = instance.subtaskInstances.length;
    instance.subtaskInstances = instance.subtaskInstances.filter(si => 
      currentSubtaskIds.has(si.subtaskId.toString())
    );
    
    if (instance.subtaskInstances.length !== originalLength) {
      needsUpdate = true;
      console.log(`Removed ${originalLength - instance.subtaskInstances.length} obsolete subtask instances`);
    }
    
    if (needsUpdate) {
      await instance.save();
      console.log(`Synced task instance with current subtasks`);
    }
  }

  return instance;
};

// @route   GET /api/task-instances/date/:date
// @desc    Get task instances for a specific date
// @access  Private
router.get('/date/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    console.log('Server: Received request for date:', date);
    console.log('Server: User ID:', req.user._id);
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      console.log('Server: Invalid date format:', date);
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    // Parse date components to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const targetDate = new Date(year, month - 1, day);
    
    if (isNaN(targetDate.getTime())) {
      console.log('Server: Invalid date:', date);
      return res.status(400).json({ message: 'Invalid date' });
    }

    console.log('Server: Target date:', targetDate);

    // Find all tasks that should be active on this date
    const activeTasks = await Task.findTasksForDate(req.user._id, targetDate);
    console.log('Server: Found active tasks:', activeTasks.length);
    
    // Get or create instances for each active task
    const taskInstances = [];
    for (const task of activeTasks) {
      try {
        const instance = await getOrCreateTaskInstance(task._id, req.user._id, targetDate);
        
        // Populate the task and subtask details
        await instance.populate([
          { path: 'taskId', select: 'title startDate endDate' },
          { path: 'subtaskInstances.subtaskId', select: 'title notes' }
        ]);
        
        taskInstances.push(instance);
      } catch (instanceError) {
        console.error('Server: Error creating task instance for task:', task._id, instanceError);
      }
    }
    
    console.log('Server: Returning task instances:', taskInstances.length);
    res.json({ taskInstances, date });
  } catch (error) {
    console.error('Get task instances error:', error);
    res.status(500).json({ message: 'Server error while fetching task instances' });
  }
});

// @route   PUT /api/task-instances/:id/complete
// @desc    Toggle task instance completion
// @access  Private
router.put('/:id/complete', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const instance = await TaskInstance.findOne({ _id: id, userId: req.user._id });
    if (!instance) {
      return res.status(404).json({ message: 'Task instance not found' });
    }

    instance.completed = !instance.completed;
    
    // If task is being marked as complete, mark all subtasks as complete
    // If task is being marked as incomplete, mark all subtasks as incomplete
    instance.subtaskInstances.forEach(subtaskInstance => {
      subtaskInstance.completed = instance.completed;
    });

    await instance.save();

    // Populate for response
    await instance.populate([
      { path: 'taskId', select: 'title startDate endDate' },
      { path: 'subtaskInstances.subtaskId', select: 'title notes' }
    ]);

    res.json({ message: 'Task instance updated successfully', taskInstance: instance });
  } catch (error) {
    console.error('Update task instance error:', error);
    res.status(500).json({ message: 'Server error while updating task instance' });
  }
});

// @route   PUT /api/task-instances/:id/subtask/:subtaskId
// @desc    Toggle subtask instance completion
// @access  Private
router.put('/:id/subtask/:subtaskId', auth, async (req, res) => {
  try {
    const { id, subtaskId } = req.params;

    const instance = await TaskInstance.findOne({ _id: id, userId: req.user._id });
    if (!instance) {
      return res.status(404).json({ message: 'Task instance not found' });
    }

    const subtaskInstance = instance.subtaskInstances.find(
      si => si.subtaskId.toString() === subtaskId
    );

    if (!subtaskInstance) {
      return res.status(404).json({ message: 'Subtask instance not found' });
    }

    subtaskInstance.completed = !subtaskInstance.completed;
    
    // Check if all subtasks are completed to auto-complete the main task
    const allSubtasksCompleted = instance.subtaskInstances.every(si => si.completed);
    const anySubtaskIncomplete = instance.subtaskInstances.some(si => !si.completed);
    
    // Auto-complete task if all subtasks are completed
    if (allSubtasksCompleted && instance.subtaskInstances.length > 0) {
      instance.completed = true;
    }
    // Auto-incomplete task if any subtask is incomplete and task was previously completed
    else if (anySubtaskIncomplete && instance.completed) {
      instance.completed = false;
    }

    await instance.save();

    // Populate for response
    await instance.populate([
      { path: 'taskId', select: 'title startDate endDate' },
      { path: 'subtaskInstances.subtaskId', select: 'title notes' }
    ]);

    res.json({ message: 'Subtask instance updated successfully', taskInstance: instance });
  } catch (error) {
    console.error('Update subtask instance error:', error);
    res.status(500).json({ message: 'Server error while updating subtask instance' });
  }
});

module.exports = router;