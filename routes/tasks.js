const express = require('express');
const { body, validationResult } = require('express-validator');
const Task = require('../models/Task');
const Subtask = require('../models/Subtask');
const auth = require('../middleware/auth');

const router = express.Router();

// @route   GET /api/tasks
// @desc    Get all user tasks
// @access  Private
router.get('/', auth, async (req, res) => {
  try {
    const tasks = await Task.find({ userId: req.user._id })
      .populate('subtasks')
      .sort({ createdAt: -1 }); // Sort by newest first
    
    res.json({ tasks });
  } catch (error) {
    console.error('Get tasks error:', error);
    res.status(500).json({ message: 'Server error while fetching tasks' });
  }
});

// @route   GET /api/tasks/static
// @desc    Get static tasks (tasks without dates)
// @access  Private
router.get('/static', auth, async (req, res) => {
  try {
    const tasks = await Task.find({ 
      userId: req.user._id,
      $or: [
        { startDate: null },
        { endDate: null },
        { $and: [{ startDate: { $exists: false } }, { endDate: { $exists: false } }] }
      ]
    })
      .populate('subtasks')
      .sort({ order: 1, createdAt: -1 });
    
    res.json({ tasks });
  } catch (error) {
    console.error('Get static tasks error:', error);
    res.status(500).json({ message: 'Server error while fetching static tasks' });
  }
});

// @route   GET /api/tasks/today
// @desc    Get today's tasks
// @access  Private
router.get('/today', auth, async (req, res) => {
  try {
    const today = new Date();
    const tasks = await Task.findTasksForDate(req.user._id, today);
    
    res.json({ tasks, date: today.toISOString().split('T')[0] });
  } catch (error) {
    console.error('Get today tasks error:', error);
    res.status(500).json({ message: 'Server error while fetching today\'s tasks' });
  }
});

// @route   GET /api/tasks/date/:date
// @desc    Get tasks for specific date (YYYY-MM-DD)
// @access  Private
router.get('/date/:date', auth, async (req, res) => {
  try {
    const { date } = req.params;
    
    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
    }
    
    const targetDate = new Date(date);
    if (isNaN(targetDate.getTime())) {
      return res.status(400).json({ message: 'Invalid date' });
    }
    
    const tasks = await Task.findTasksForDate(req.user._id, targetDate);
    
    res.json({ tasks, date });
  } catch (error) {
    console.error('Get tasks by date error:', error);
    res.status(500).json({ message: 'Server error while fetching tasks for date' });
  }
});

// @route   POST /api/tasks
// @desc    Create a new task
// @access  Private
router.post('/', [
  auth,
  body('title').trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  body('endDate').optional().isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { title, startDate, endDate } = req.body;
    
    // Validate date range if both dates are provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      // Normalize dates to start of day for proper comparison
      start.setHours(0, 0, 0, 0);
      end.setHours(0, 0, 0, 0);
      
      if (end < start) {
        return res.status(400).json({ message: 'End date must be after or equal to start date' });
      }
    }

    // Validate that if one date is provided, both should be provided
    if ((startDate && !endDate) || (!startDate && endDate)) {
      return res.status(400).json({ message: 'Both start date and end date must be provided together, or leave both empty for static tasks' });
    }

    // Get the next order number for this task type
    let nextOrder = 1;
    if (startDate && endDate) {
      // For date-based tasks, get the highest order for this date
      const existingTasks = await Task.findTasksForDate(req.user._id, new Date(startDate));
      if (existingTasks.length > 0) {
        const maxOrder = Math.max(...existingTasks.map(t => t.order || 0));
        nextOrder = maxOrder + 1;
      }
    } else {
      // For static tasks, get the highest order
      const existingTasks = await Task.find({ 
        userId: req.user._id,
        $or: [
          { startDate: null },
          { endDate: null },
          { $and: [{ startDate: { $exists: false } }, { endDate: { $exists: false } }] }
        ]
      });
      if (existingTasks.length > 0) {
        const maxOrder = Math.max(...existingTasks.map(t => t.order || 0));
        nextOrder = maxOrder + 1;
      }
    }

    const taskData = {
      title,
      userId: req.user._id,
      order: nextOrder
    };

    // Only add dates if both are provided
    if (startDate && endDate) {
      taskData.startDate = new Date(startDate);
      taskData.endDate = new Date(endDate);
    }

    const task = new Task(taskData);
    await task.save();
    await task.populate('subtasks');

    res.status(201).json({ message: 'Task created successfully', task });
  } catch (error) {
    console.error('Create task error:', error);
    res.status(500).json({ message: 'Server error while creating task' });
  }
});

// @route   PUT /api/tasks/:id
// @desc    Update a task
// @access  Private
router.put('/:id', [
  auth,
  body('title').optional().trim().isLength({ min: 1, max: 200 }).withMessage('Title must be 1-200 characters'),
  body('completed').optional().isBoolean().withMessage('Completed must be a boolean'),
  body('startDate').optional().isISO8601().withMessage('Start date must be a valid date'),
  body('endDate').optional().isISO8601().withMessage('End date must be a valid date')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const updates = req.body;

    const task = await Task.findOne({ _id: id, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Validate date range if dates are being updated
    if (updates.startDate || updates.endDate) {
      const startDate = updates.startDate ? new Date(updates.startDate) : task.startDate;
      const endDate = updates.endDate ? new Date(updates.endDate) : task.endDate;
      
      // Normalize dates to start of day for proper comparison
      if (startDate) startDate.setHours(0, 0, 0, 0);
      if (endDate) endDate.setHours(0, 0, 0, 0);
      
      if (endDate && startDate && endDate < startDate) {
        return res.status(400).json({ message: 'End date must be after or equal to start date' });
      }
    }

    // If task completion is being toggled, update all subtasks accordingly
    if (updates.hasOwnProperty('completed')) {
      await Subtask.updateMany(
        { taskId: id },
        { completed: updates.completed }
      );
    }

    Object.assign(task, updates);
    await task.save();
    await task.populate('subtasks');

    res.json({ message: 'Task updated successfully', task });
  } catch (error) {
    console.error('Update task error:', error);
    res.status(500).json({ message: 'Server error while updating task' });
  }
});

// @route   DELETE /api/tasks/:id
// @desc    Delete a task and its subtasks
// @access  Private
router.delete('/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;

    const task = await Task.findOne({ _id: id, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    // Delete all subtasks first
    await Subtask.deleteMany({ taskId: id });
    
    // Delete the task
    await Task.findByIdAndDelete(id);

    res.json({ message: 'Task and its subtasks deleted successfully' });
  } catch (error) {
    console.error('Delete task error:', error);
    res.status(500).json({ message: 'Server error while deleting task' });
  }
});

// @route   POST /api/tasks/:taskId/subtasks
// @desc    Create a subtask for a task
// @access  Private
router.post('/:taskId/subtasks', [
  auth,
  body('title').trim().isLength({ min: 1, max: 150 }).withMessage('Title must be 1-150 characters'),
  body('notes').optional().trim().isLength({ max: 500 }).withMessage('Notes cannot exceed 500 characters')
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { taskId } = req.params;
    const { title, notes } = req.body;

    // Verify task exists and belongs to user
    const task = await Task.findOne({ _id: taskId, userId: req.user._id });
    if (!task) {
      return res.status(404).json({ message: 'Task not found' });
    }

    const subtask = new Subtask({
      title,
      notes: notes || '',
      taskId
    });

    await subtask.save();

    // Add subtask to task's subtasks array
    task.subtasks.push(subtask._id);
    await task.save();

    // IMPORTANT: Update all existing task instances to include the new subtask instance
    const TaskInstance = require('../models/TaskInstance');
    const existingInstances = await TaskInstance.find({ taskId, userId: req.user._id });
    
    console.log(`Found ${existingInstances.length} existing task instances to update with new subtask`);
    
    for (const instance of existingInstances) {
      // Add the new subtask instance to the existing task instance
      instance.subtaskInstances.push({
        subtaskId: subtask._id,
        completed: false
      });
      await instance.save();
    }

    console.log(`Updated ${existingInstances.length} task instances with new subtask`);

    res.status(201).json({ message: 'Subtask created successfully', subtask });
  } catch (error) {
    console.error('Create subtask error:', error);
    res.status(500).json({ message: 'Server error while creating subtask' });
  }
});

// @route   PUT /api/tasks/:id/order
// @desc    Update task order
// @access  Private
router.put('/:id/order', [
  auth,
  body('direction').isIn(['up', 'down']).withMessage('Direction must be up or down')
], async (req, res) => {
  try {
    console.log('=== TASK REORDER REQUEST ===');
    console.log('Task ID:', req.params.id);
    console.log('Direction:', req.body.direction);
    console.log('User ID:', req.user._id);
    
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      console.log('Validation errors:', errors.array());
      return res.status(400).json({ message: 'Validation failed', errors: errors.array() });
    }

    const { id } = req.params;
    const { direction } = req.body;

    const task = await Task.findOne({ _id: id, userId: req.user._id });
    if (!task) {
      console.log('Task not found for user');
      return res.status(404).json({ message: 'Task not found' });
    }

    console.log('Found task:', task.title, 'Current order:', task.order);

    // Get all tasks for the same date or static tasks
    let allTasks;
    if (task.startDate && task.endDate) {
      // Date-based task - get tasks for the same date
      console.log('Getting date-based tasks for:', task.startDate);
      allTasks = await Task.findTasksForDate(req.user._id, task.startDate);
    } else {
      // Static task
      console.log('Getting static tasks');
      allTasks = await Task.find({ 
        userId: req.user._id,
        $or: [
          { startDate: null },
          { endDate: null },
          { $and: [{ startDate: { $exists: false } }, { endDate: { $exists: false } }] }
        ]
      }).sort({ order: 1, createdAt: -1 });
    }

    console.log('All tasks found:', allTasks.length);
    console.log('Task orders before:', allTasks.map(t => ({ title: t.title, order: t.order })));

    if (allTasks.length <= 1) {
      console.log('Cannot reorder with only one task');
      return res.status(400).json({ message: 'Cannot reorder with only one task' });
    }

    // Initialize orders if needed - ensure all tasks have proper sequential orders
    const hasProperOrders = allTasks.every(t => t.order > 0) && 
                           new Set(allTasks.map(t => t.order)).size === allTasks.length;
    
    if (!hasProperOrders) {
      console.log('Initializing task orders...');
      // Sort by existing order (if any) then by creation date
      allTasks.sort((a, b) => {
        if (a.order !== b.order) return (a.order || 0) - (b.order || 0);
        return new Date(a.createdAt) - new Date(b.createdAt);
      });
      
      // Assign sequential orders
      for (let i = 0; i < allTasks.length; i++) {
        allTasks[i].order = i + 1;
        await allTasks[i].save();
      }
      console.log('Orders initialized:', allTasks.map(t => ({ title: t.title, order: t.order })));
    }

    // Re-sort by order to ensure correct positioning
    allTasks.sort((a, b) => a.order - b.order);

    // Find current task index
    const currentIndex = allTasks.findIndex(t => t._id.toString() === id);
    if (currentIndex === -1) {
      console.log('Task not found in list after sorting');
      return res.status(404).json({ message: 'Task not found in list' });
    }

    console.log('Current task index:', currentIndex);

    // Calculate target position
    let targetIndex;
    if (direction === 'up' && currentIndex > 0) {
      targetIndex = currentIndex - 1;
    } else if (direction === 'down' && currentIndex < allTasks.length - 1) {
      targetIndex = currentIndex + 1;
    } else {
      console.log(`Cannot move task ${direction} from position ${currentIndex}`);
      return res.status(400).json({ message: `Cannot move task ${direction}` });
    }

    console.log('Target index:', targetIndex);

    // Get the tasks to swap
    const currentTask = allTasks[currentIndex];
    const targetTask = allTasks[targetIndex];
    
    console.log(`Moving task "${currentTask.title}" from position ${currentIndex + 1} to ${targetIndex + 1}`);
    console.log(`Current task order: ${currentTask.order}, Target task order: ${targetTask.order}`);
    
    // Swap the order values
    const tempOrder = currentTask.order;
    currentTask.order = targetTask.order;
    targetTask.order = tempOrder;

    // Save both tasks
    await Promise.all([
      currentTask.save(),
      targetTask.save()
    ]);

    console.log(`Task orders swapped successfully: "${currentTask.title}" now has order ${currentTask.order}, "${targetTask.title}" now has order ${targetTask.order}`);
    console.log('=== TASK REORDER COMPLETE ===');
    
    res.json({ 
      message: 'Task order updated successfully',
      movedTask: {
        id: currentTask._id,
        title: currentTask.title,
        newOrder: currentTask.order
      }
    });
  } catch (error) {
    console.error('Update task order error:', error);
    res.status(500).json({ message: 'Server error while updating task order' });
  }
});

module.exports = router;