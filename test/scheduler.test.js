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
    maxConsecutiveDays: 31
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

test('aborts gracefully instead of hanging when the time budget is exceeded', () => {
  const patterns = [
    { id: 'a', name: 'Morning', maxPerWeek: 3, startHour: 6, endHour: 14 },
    { id: 'b', name: 'Day', maxPerWeek: 3, startHour: 9, endHour: 18 },
    { id: 'c', name: 'Evening', maxPerWeek: 3, startHour: 14, endHour: 22 },
    { id: 'd', name: 'Night', maxPerWeek: 2, startHour: 22, endHour: 6 }
  ];

  const workers = Array.from({ length: 20 }, (_, i) => ({
    name: `Worker${i}`,
    patternIds: ['a', 'b', 'c', 'd']
  }));

  const hourlyRequirements = Array.from({ length: 24 }, (_, hour) => (hour >= 6 && hour < 22 ? 5 : 2));

  const start = Date.now();
  const result = generateSchedule({
    month: '2026-08',
    workers,
    patterns,
    hourlyRequirements,
    maxConsecutiveDays: 3,
    timeBudgetMs: 300
  });
  const elapsed = Date.now() - start;

  assert.equal(result.success, false);
  assert.ok(elapsed < 3000, `expected to abort quickly but took ${elapsed}ms`);
});

test('worker can be assigned from multiple allowed patterns', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'a', name: 'A', maxPerWeek: 31, startHour: 9, endHour: 13 },
      { id: 'c', name: 'C', maxPerWeek: 31, startHour: 13, endHour: 17 }
    ],
    workers: [
      { name: '山本', patternIds: ['a', 'c'] },
      { name: '田中', patternIds: ['a'] }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 14 ? 1 : 0)),
    maxConsecutiveDays: 31
  });

  assert.equal(result.success, true);
  assert.equal(result.assignments[0].shifts[0].name, '山本');
  assert.equal(result.assignments[0].shifts[0].patternName, 'C');
});
