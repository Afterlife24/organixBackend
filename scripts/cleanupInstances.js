require('dotenv').config();
const mongoose = require('mongoose');
const Task = require('../models/Task');
const TaskInstance = require('../models/TaskInstance');

const cleanup = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const tasks = await Task.find({ startDate: { $ne: null }, endDate: { $ne: null } });
  let totalDeleted = 0;

  for (const task of tasks) {
    const end = new Date(task.endDate);
    end.setHours(23, 59, 59, 999);

    // Delete instances created after the task's end date (orphans from carry-forward bug)
    const result = await TaskInstance.deleteMany({
      taskId: task._id,
      date: { $gt: end }
    });

    if (result.deletedCount > 0) {
      console.log(`  Cleaned ${result.deletedCount} orphan instances for: "${task.title}"`);
      totalDeleted += result.deletedCount;
    }
  }

  console.log(`\nTotal orphan instances removed: ${totalDeleted}`);
  await mongoose.connection.close();
  process.exit(0);
};

cleanup().catch(err => { console.error(err.message); process.exit(1); });
