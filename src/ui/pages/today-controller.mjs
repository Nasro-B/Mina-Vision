export function createTodayController({
  dailyBriefingService, calendarService = null, taskRepository = null, routineRegistry = null,
} = {}) {
  if (!dailyBriefingService?.build) throw new TypeError('today_controller_dependencies_required');

  return Object.freeze({
    getBriefing: (input) => dailyBriefingService.build(input),
    listCalendarEvents: (filters) => (calendarService ? calendarService.list(filters) : []),
    listTasks: () => (taskRepository ? taskRepository.list() : []),
    async listRoutines() {
      return routineRegistry ? routineRegistry.listRoutines() : [];
    },
    async setRoutineStatus({ routineId, status } = {}) {
      if (!routineRegistry) throw new Error('routine_registry_not_configured');
      return routineRegistry.setStatus(routineId, status);
    },
  });
}
