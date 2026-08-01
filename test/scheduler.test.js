const test = require('node:test');
const assert = require('node:assert/strict');
const { generateSchedule } = require('../scheduler');

test('fails when hourly staffing requirements cannot be met', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'p1', name: 'A', maxPerWeek: 7, startHour: 9, endHour: 17 }
    ],
    workers: [
      { name: 'Alice', patternId: 'p1' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 2 : 0)),
    maxConsecutiveDays: 5
  });

  assert.equal(result.success, false);
});

test('enforces maximum consecutive work days', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'p1', name: 'A', maxPerWeek: 7, startHour: 9, endHour: 17 }
    ],
    workers: [
      { name: 'Alice', patternId: 'p1' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0)),
    maxConsecutiveDays: 1
  });

  assert.equal(result.success, false);
});

test('night shift workers get a rest day after overnight completion day', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'night', name: 'Night', maxPerWeek: 7, startHour: 22, endHour: 6 }
    ],
    workers: [
      { name: 'Alice', patternId: 'night' },
      { name: 'Bob', patternId: 'night' },
      { name: 'Carol', patternId: 'night' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 1 : 0)),
    maxConsecutiveDays: 7
  });

  assert.equal(result.success, true);

  const daysByWorker = new Map();
  for (const assignment of result.assignments) {
    for (const workerName of assignment.workers) {
      if (!daysByWorker.has(workerName)) {
        daysByWorker.set(workerName, []);
      }
      daysByWorker.get(workerName).push(assignment.day);
    }
  }

  for (const days of daysByWorker.values()) {
    const set = new Set(days);
    for (const day of days) {
      assert.equal(set.has(day + 2), false);
    }
  }
});
