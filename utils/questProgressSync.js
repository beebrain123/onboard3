const UserQuestProgress = require('../models/UserQuestProgress');

function syncQuestProgress(progress, quest) {
  const currentTasks = [...(quest.tasks || []), ...(quest.dailyTasks || [])];
  const existing = (progress.taskProgress || []).map(item => item.toObject ? item.toObject() : { ...item });
  const existingById = new Map(existing.map(item => [String(item.taskId), item]));
  const validIds = new Set(currentTasks.map(task => String(task._id)));
  const taskProgress = currentTasks.map(task => existingById.get(String(task._id)) || ({
    taskId: task._id,
    isCompleted: false,
    xpEarned: 0,
    approvalStatus: 'auto'
  }));
  const tasksCompleted = taskProgress.filter(item => item.isCompleted).length;
  const totalTasks = currentTasks.length;
  const percent = totalTasks ? Math.round((tasksCompleted / totalTasks) * 100) : 0;
  let status = progress.status;
  let completedAt = progress.completedAt || null;
  let isWinner = progress.isWinner || false;
  let winnerRank = progress.winnerRank || null;
  let leaderboardRank = progress.leaderboardRank || null;

  if (status !== 'abandoned') {
    if (totalTasks > 0 && tasksCompleted === totalTasks) {
      if (status !== 'completed' || !completedAt) {
        status = 'completed';
        const taskDates = taskProgress.map(item => item.completedAt).filter(Boolean).map(value => new Date(value));
        completedAt = taskDates.length ? new Date(Math.max(...taskDates.map(date => date.getTime()))) : new Date();
      }
    } else if (status === 'completed') {
      status = 'in_progress';
      completedAt = null;
      isWinner = false;
      winnerRank = null;
      leaderboardRank = null;
    }
  }

  const oldIds = existing.map(item => String(item.taskId));
  const nextIds = taskProgress.map(item => String(item.taskId));
  const sameIds = oldIds.length === nextIds.length && oldIds.every((id, index) => id === nextIds[index]);
  const oldCompletedAt = progress.completedAt ? new Date(progress.completedAt).getTime() : null;
  const nextCompletedAt = completedAt ? new Date(completedAt).getTime() : null;
  const changed = !sameIds || Number(progress.tasksCompleted || 0) !== tasksCompleted ||
    Number(progress.totalTasks || 0) !== totalTasks || Number(progress.progress || 0) !== percent ||
    progress.status !== status || oldCompletedAt !== nextCompletedAt ||
    Boolean(progress.isWinner) !== Boolean(isWinner) || (progress.winnerRank || null) !== winnerRank ||
    (progress.leaderboardRank || null) !== leaderboardRank;

  if (changed) {
    progress.taskProgress = taskProgress;
    progress.tasksCompleted = tasksCompleted;
    progress.totalTasks = totalTasks;
    progress.progress = percent;
    progress.status = status;
    progress.completedAt = completedAt;
    progress.isWinner = isWinner;
    progress.winnerRank = winnerRank;
    progress.leaderboardRank = leaderboardRank;
  }
  return changed;
}

async function syncQuestProgressForQuest(quest) {
  const progresses = await UserQuestProgress.find({ questId: quest._id }).lean();
  const operations = [];
  let reopened = 0;
  for (const progress of progresses) {
    const wasCompleted = progress.status === 'completed';
    if (syncQuestProgress(progress, quest)) {
      if (wasCompleted && progress.status !== 'completed') reopened++;
      operations.push({ updateOne: { filter: { _id: progress._id }, update: { $set: {
        taskProgress: progress.taskProgress,
        tasksCompleted: progress.tasksCompleted,
        totalTasks: progress.totalTasks,
        progress: progress.progress,
        status: progress.status,
        completedAt: progress.completedAt,
        isWinner: progress.isWinner,
        winnerRank: progress.winnerRank,
        leaderboardRank: progress.leaderboardRank
      } } } });
    }
  }
  if (operations.length) await UserQuestProgress.bulkWrite(operations, { ordered: false });
  return { updated: operations.length, reopened };
}

module.exports = { syncQuestProgress, syncQuestProgressForQuest };
