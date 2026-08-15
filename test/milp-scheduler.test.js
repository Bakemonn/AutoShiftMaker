const assert = require('node:assert/strict');
const test = require('node:test');
const loadHighs = require('highs');

const {
  buildAlternativeSchedules,
  buildMilpModel,
  parseMilpResult
} = require('../milp-scheduler');
const { buildQuarterRange } = require('../scheduler');
const testPattern = require('../test-pattern');

test('月間テストパターンの最小ヘルプ量と代替案を生成する', { timeout: 40000 }, async () => {
  const highs = await loadHighs();
  const input = { month: '2026-08', ...testPattern, objectiveMode: 'schedule' };
  const built = buildMilpModel(input);
  const solution = highs.solve(built.lp, {
    output_flag: false,
    presolve: 'on',
    time_limit: 30,
    mip_rel_gap: 0,
    mip_abs_gap: 0.5
  });
  const result = parseMilpResult(solution, built.metadata);

  assert.equal(solution.Status, 'Optimal');
  assert.equal(result.success, true);
  assert.equal(result.helpQuarterTotal, 45);
  assert.ok(result.helpRequests.length > 0);

  const patterns = new Map(testPattern.patterns.map((pattern) => [pattern.name, pattern]));
  const workDays = new Map(testPattern.workers.map((worker) => [worker.name, new Set()]));
  const patternHistory = new Map(testPattern.workers.map((worker) => [worker.name, []]));
  for (const assignment of result.assignments) {
    const coverage = Array(96).fill(0);
    for (const shift of assignment.shifts) {
      workDays.get(shift.name).add(assignment.day);
      patternHistory.get(shift.name)[assignment.day - 1] = shift.patternName;
      for (const quarter of buildQuarterRange(patterns.get(shift.patternName))) coverage[quarter] += 1;
    }
    for (const status of assignment.statuses) {
      if (status.status === '明') workDays.get(status.name).add(assignment.day);
    }
    for (const request of result.helpRequests.filter((item) => item.day === assignment.day)) {
      const toQuarter = (time) => {
        if (time === '24:00') return 96;
        const [hour, minute] = time.split(':').map(Number);
        return hour * 4 + minute / 15;
      };
      for (let quarter = toQuarter(request.startTime); quarter < toQuarter(request.endTime); quarter += 1) {
        coverage[quarter] += request.count;
      }
    }
    coverage.forEach((actual, quarter) => {
      assert.ok(actual >= testPattern.hourlyRequirements[Math.floor(quarter / 4)]);
    });
  }

  for (const worker of testPattern.workers) {
    assert.equal(31 - workDays.get(worker.name).size, worker.requiredDaysOff, worker.name);
    const history = patternHistory.get(worker.name);
    const mrL = history.filter((name) => ['M', 'R', 'L'].includes(name)).length;
    const ichi = history.filter((name) => name === '①').length;
    assert.equal(mrL, ichi, worker.name);
  }

  const alternatives = buildAlternativeSchedules(result, input, 3);
  assert.equal(alternatives.length, 3);
  assert.equal(new Set(alternatives.map((item) => JSON.stringify(item.assignments))).size, 3);
  assert.ok(alternatives.every((item) => item.helpQuarterTotal === 45));
});
