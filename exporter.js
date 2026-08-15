(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined') {
    module.exports = value;
  }
  if (root) {
    root.AutoShiftExporter = value;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  function calculateWorkDays(result, workerNames) {
    const counts = new Map((workerNames || []).map((name) => [name, 0]));

    for (const assignment of result.assignments || []) {
      const workingNames = new Set((assignment.shifts || []).map((shift) => shift.name));
      for (const status of assignment.statuses || []) {
        if (status.status === '明') workingNames.add(status.name);
      }
      for (const name of workingNames) {
        if (counts.has(name)) counts.set(name, counts.get(name) + 1);
      }
    }

    return counts;
  }

  function buildScheduleTable(result, workerNames) {
    const names = Array.isArray(workerNames) ? workerNames : [];
    const assignments = result.assignments || [];
    const workDays = calculateWorkDays(result, names);
    const shiftsByDate = assignments.map((assignment) => new Map(
      (assignment.shifts || []).map((shift) => [shift.name, shift.patternName])
    ));
    const statusesByDate = assignments.map((assignment) => new Map(
      (assignment.statuses || []).map((status) => [status.name, status.status])
    ));

    return [
      ['勤務者', ...assignments.map((assignment) => assignment.date), '勤務日数'],
      ...names.map((name) => [
        name,
        ...shiftsByDate.map((shifts, index) => shifts.get(name) || statusesByDate[index].get(name) || '公休'),
        workDays.get(name)
      ])
    ];
  }

  function escapeCell(value, delimiter) {
    const text = String(value ?? '');
    if (text.includes(delimiter) || /["\r\n]/.test(text)) {
      return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
  }

  function toDelimitedText(rows, delimiter) {
    return rows
      .map((row) => row.map((value) => escapeCell(value, delimiter)).join(delimiter))
      .join('\r\n');
  }

  function toCsv(rows) {
    return toDelimitedText(rows, ',');
  }

  function toTsv(rows) {
    return toDelimitedText(rows, '\t');
  }

  return { buildScheduleTable, calculateWorkDays, toCsv, toTsv };
});
