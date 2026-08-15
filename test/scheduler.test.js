const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildQuarterRange,
  canAssignNightPattern,
  fillHourlyRequirements,
  generateSchedule,
  getPatternDayMarkers,
  hasBalancedShiftCounts,
  isPatternTransitionAllowed
} = require('../scheduler');
const testPattern = require('../test-pattern');

test('fillHourlyRequirements carries forward the previous value when blank', () => {
  const raw = ['3', '', '', '5', '', ''];
  const filled = fillHourlyRequirements(raw);

  assert.deepEqual(filled.slice(0, 6), [3, 3, 3, 5, 5, 5]);
});

test('fillHourlyRequirements defaults to 0 when the first hour is blank', () => {
  const raw = ['', '', '4'];
  const filled = fillHourlyRequirements(raw);

  assert.deepEqual(filled.slice(0, 3), [0, 0, 4]);
});

test('fillHourlyRequirements returns an array of 24 hours regardless of input length', () => {
  const filled = fillHourlyRequirements(['2']);

  assert.equal(filled.length, 24);
  assert.ok(filled.every((value) => value === 2));
});

test('fails when hourly staffing requirements cannot be met', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'p1', name: 'A', startHour: 9, endHour: 17 }
    ],
    workers: [
      { name: 'Alice', patternId: 'p1' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 2 : 0))
  });

  assert.equal(result.success, false);
});

test('1人では固定4連勤上限により毎日の必要人数を満たせない', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'p1', name: 'A', startHour: 9, endHour: 17 }
    ],
    workers: [
      { name: 'Alice', patternId: 'p1' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0))
  });

  assert.equal(result.success, false);
});

test('翌日公休の勤務体系では勤務開始日の翌日を休みにする', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'day', name: 'Day', startHour: 9, endHour: 17, nextDayOff: true }
    ],
    workers: [
      { name: 'Alice', patternId: 'day' },
      { name: 'Bob', patternId: 'day' },
      { name: 'Carol', patternId: 'day' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0))
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
      assert.equal(set.has(day + 1), false);
    }
  }
});

test('15分単位の勤務時間と休憩を勤務枠へ反映する', () => {
  const quarters = buildQuarterRange({
    startHour: 17,
    startMinute: 15,
    endHour: 11,
    endMinute: 15,
    breaks: [{ startHour: 9, endHour: 10 }]
  });

  assert.equal(quarters.includes(17 * 4), false);
  assert.equal(quarters.includes(17 * 4 + 1), true);
  assert.equal(quarters.includes(9 * 4), false);
  assert.equal(quarters.includes(10 * 4), true);
  assert.equal(quarters.includes(11 * 4), true);
  assert.equal(quarters.includes(11 * 4 + 1), false);
});

test('連続勤務は4日を超えない', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'day', name: 'Day', startHour: 9, endHour: 17 }
    ],
    workers: [
      { name: 'Alice', patternId: 'day' },
      { name: 'Bob', patternId: 'day' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0))
  });

  assert.equal(result.success, true);
  for (const workerName of ['Alice', 'Bob']) {
    let consecutive = 0;
    for (const assignment of result.assignments) {
      consecutive = assignment.workers.includes(workerName) ? consecutive + 1 : 0;
      assert.ok(consecutive <= 4, `${workerName}が${consecutive}連勤しています`);
    }
  }
});

test('担当者の希望休には勤務を割り当てない', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [{ id: 'day', name: 'Day', startHour: 9, endHour: 17 }],
    workers: [
      { name: 'Alice', patternId: 'day', requestedDaysOff: [1, 5, 31] },
      { name: 'Bob', patternId: 'day' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0))
  });

  assert.equal(result.success, true);
  for (const day of [1, 5, 31]) {
    assert.equal(result.assignments[day - 1].workers.includes('Alice'), false);
  }
});

test('翌日公休でない勤務体系は翌日も割り当てできる', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'night', name: 'Night', startHour: 22, endHour: 6, nextDayOff: false }
    ],
    workers: [
      { name: 'Alice', patternId: 'night' },
      { name: 'Bob', patternId: 'night' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 22 ? 1 : 0))
  });

  assert.equal(result.success, true);
  assert.ok(result.assignments.some((assignment, index) => index > 0
    && assignment.workers.some((name) => result.assignments[index - 1].workers.includes(name))));
});

test('勤務人数対象外時間の担当者を必要人数から除外する', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [{ id: 'day', name: 'Day', startHour: 9, endHour: 17 }],
    workers: [
      { name: 'Alice', patternId: 'day' },
      { name: 'Bob', patternId: 'day' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 1 : 0)),
    absenceRules: [{
      id: 'absence-1',
      workerNames: ['Alice'],
      date: '2026-08-10',
      startTime: '12:00',
      endTime: '13:00'
    }]
  });

  assert.equal(result.success, true);
  const targetDay = result.assignments.find((assignment) => assignment.day === 10);
  assert.deepEqual(targetDay.temporaryAbsences, [{
    ruleId: 'absence-1',
    name: 'Alice',
    startTime: '12:00',
    endTime: '13:00'
  }]);
  assert.ok(targetDay.workers.includes('Alice'));
  assert.ok(targetDay.workers.includes('Bob'));
});

test('複数候補の勤務人数対象外時間では勤務中の1人を選択する', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [{ id: 'day', name: 'Day', startHour: 9, endHour: 17 }],
    workers: [
      { name: 'Alice', patternId: 'day' },
      { name: 'Bob', patternId: 'day' },
      { name: 'Carol', patternId: 'day' }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 1 : 0)),
    absenceRules: [{
      workerNames: ['Alice', 'Bob'],
      date: '2026-08-10',
      startTime: '12:15',
      endTime: '12:45'
    }]
  });

  assert.equal(result.success, true);
  const targetDay = result.assignments.find((assignment) => assignment.day === 10);
  assert.equal(targetDay.temporaryAbsences.length, 1);
  assert.ok(['Alice', 'Bob'].includes(targetDay.temporaryAbsences[0].name));
  assert.ok(targetDay.workers.includes(targetDay.temporaryAbsences[0].name));
});

test('aborts gracefully instead of hanging when the time budget is exceeded', () => {
  const patterns = [
    { id: 'a', name: 'Morning', startHour: 6, endHour: 14 },
    { id: 'b', name: 'Day', startHour: 9, endHour: 18 },
    { id: 'c', name: 'Evening', startHour: 14, endHour: 22 },
    { id: 'd', name: 'Night', startHour: 22, endHour: 6 }
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
      { id: 'a', name: 'A', startHour: 9, endHour: 13 },
      { id: 'c', name: 'C', startHour: 13, endHour: 17 }
    ],
    workers: [
      { name: '山本', patternIds: ['a', 'c'] },
      { name: '田中', patternIds: ['a', 'c'] }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 14 ? 1 : 0))
  });

  assert.equal(result.success, true);
  assert.ok(result.assignments.every((assignment) => assignment.shifts[0].patternName === 'C'));
});

test('必要人数を満たす勤務形態のうち余剰時間が少ないものを優先する', () => {
  const result = generateSchedule({
    month: '2026-08',
    patterns: [
      { id: 'long', name: '長時間', startHour: 9, endHour: 18 },
      { id: 'short', name: '短時間', startHour: 9, endHour: 10 }
    ],
    workers: [
      { name: '山田', patternIds: ['long', 'short'] },
      { name: '鈴木', patternIds: ['long', 'short'] }
    ],
    hourlyRequirements: Array.from({ length: 24 }, (_, hour) => (hour === 9 ? 1 : 0))
  });

  assert.equal(result.success, true);
  assert.ok(result.assignments.every((assignment) => assignment.shifts[0].patternName === '短時間'));
});

test('指定テストパターンの担当者・必要人数・公休日数を読み込む', () => {
  assert.equal(testPattern.workers.length, 10);
  assert.equal(testPattern.workers.find((worker) => worker.name === '5さん').requiredDaysOff, 12);
  assert.equal(testPattern.workers.find((worker) => worker.name === '6さん').requiredDaysOff, 12);
  assert.ok(testPattern.workers.filter((worker) => !['5さん', '6さん'].includes(worker.name))
    .every((worker) => worker.requiredDaysOff === 9));
  assert.deepEqual(
    [7, 8, 16, 17, 20, 0].map((hour) => testPattern.hourlyRequirements[hour]),
    [2, 3, 2, 3, 1, 1]
  );
});

test('①と夜は翌日が明、その翌日が公になる', () => {
  for (const name of ['①', '夜']) {
    assert.deepEqual(getPatternDayMarkers({ name }, 4, 31), [
      { day: 5, marker: '明' },
      { day: 6, marker: '公夜後' }
    ]);
  }
});

test('③は翌日だけ明になる', () => {
  assert.deepEqual(getPatternDayMarkers({ name: '③' }, 4, 31), [
    { day: 5, marker: '明' }
  ]);
});

test('夜勤は2連続までとする', () => {
  for (const name of ['①', '夜', '③']) {
    assert.equal(canAssignNightPattern(name, 1), true);
    assert.equal(canAssignNightPattern(name, 2), false);
  }
  assert.equal(canAssignNightPattern('D', 2), true);
});

test('M・R・L回数の合計は①回数と一致させる', () => {
  assert.equal(hasBalancedShiftCounts({ mrL: 3, ichi: 3 }), true);
  assert.equal(hasBalancedShiftCounts({ mrL: 2, ichi: 3 }), false);
});

test('連続禁止の勤務体系を判定する', () => {
  for (const previous of ['M', 'R', 'L']) {
    for (const next of ['M', 'R', 'L']) assert.equal(isPatternTransitionAllowed(previous, next), false);
  }
  for (const [previous, next] of [['E', 'D'], ['M', 'D'], ['E', 'A'], ['E', 'R'], ['M', 'A'], ['E', 'L']]) {
    assert.equal(isPatternTransitionAllowed(previous, next), false);
  }
  assert.equal(isPatternTransitionAllowed('D', 'A'), true);
});

test('勤務体系サンプルに追加分を含み既存の1を含まない', () => {
  const names = testPattern.patterns.map((pattern) => pattern.name);

  assert.deepEqual(
    ['③', '①', '夜', 'A', 'C', 'E半', '半E', 'D半', '半D', 'A短', 'L'].filter((name) => !names.includes(name)),
    []
  );
  assert.equal(names.includes('1'), false);
  assert.equal(testPattern.patterns.find((pattern) => pattern.name === '③').nextDayOff, false);
  assert.equal(testPattern.patterns.find((pattern) => pattern.name === '①').nextDayOff, true);
  assert.equal(testPattern.patterns.find((pattern) => pattern.name === '夜').nextDayOff, true);
  assert.deepEqual(
    testPattern.patterns.find((pattern) => pattern.name === 'L'),
    { id: 'L', name: 'L', startHour: 7, endHour: 18 }
  );
});
