function buildHourRange(startHour, endHour) {
  const start = Number(startHour);
  const end = Number(endHour);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 0 || end > 23) {
    throw new Error('勤務時間は0〜23で指定してください。');
  }

  if (start === end) {
    return Array.from({ length: 24 }, (_, hour) => hour);
  }

  const hours = [];
  let hour = start;
  let guard = 0;
  while (hour !== end && guard < 25) {
    hours.push(hour);
    hour = (hour + 1) % 24;
    guard += 1;
  }
  return hours;
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function createInitialState(workers) {
  const consecutive = {};
  const weeklyCounts = {};
  const forcedOffDays = {};

  for (const worker of workers) {
    consecutive[worker.name] = 0;
    weeklyCounts[worker.name] = {};
    forcedOffDays[worker.name] = new Set();
  }

  return { consecutive, weeklyCounts, forcedOffDays };
}

function cloneState(state, workers) {
  const next = {
    consecutive: {},
    weeklyCounts: {},
    forcedOffDays: {}
  };

  for (const worker of workers) {
    const name = worker.name;
    next.consecutive[name] = state.consecutive[name];
    next.weeklyCounts[name] = {};
    for (const [weekKey, patternCounts] of Object.entries(state.weeklyCounts[name])) {
      next.weeklyCounts[name][weekKey] = { ...patternCounts };
    }
    next.forcedOffDays[name] = new Set(state.forcedOffDays[name]);
  }

  return next;
}

function getPatternCount(state, workerName, weekKey, patternId) {
  const weekCounts = state.weeklyCounts[workerName][weekKey];
  if (!weekCounts) {
    return 0;
  }
  return weekCounts[patternId] || 0;
}

function normalizeWorkerPatternIds(worker) {
  if (Array.isArray(worker.patternIds)) {
    return worker.patternIds;
  }
  if (worker.patternId) {
    return [worker.patternId];
  }
  return [];
}

function allRequirementsMet(requirements, coverage) {
  for (let hour = 0; hour < 24; hour += 1) {
    if ((coverage[hour] || 0) < (requirements[hour] || 0)) {
      return false;
    }
  }
  return true;
}

function canStillMeetRequirements(requirements, coverage, remainingWorkers) {
  for (let hour = 0; hour < 24; hour += 1) {
    const need = Math.max(0, (requirements[hour] || 0) - (coverage[hour] || 0));
    if (need === 0) {
      continue;
    }

    let possible = 0;
    for (const worker of remainingWorkers) {
      if (worker.hours.includes(hour)) {
        possible += 1;
      }
    }

    if (possible < need) {
      return false;
    }
  }

  return true;
}

function isOvernight(pattern) {
  return Number(pattern.endHour) <= Number(pattern.startHour);
}

const DEFAULT_TIME_BUDGET_MS = 8000;

function generateSchedule(input) {
  const {
    month,
    workers,
    patterns,
    hourlyRequirements,
    maxConsecutiveDays,
    timeBudgetMs
  } = input || {};

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return { success: false, error: '対象月はYYYY-MM形式で指定してください。' };
  }

  if (!Array.isArray(workers) || workers.length === 0) {
    return { success: false, error: '勤務者を1人以上登録してください。' };
  }

  if (!Array.isArray(patterns) || patterns.length === 0) {
    return { success: false, error: '勤務体系を1つ以上登録してください。' };
  }

  const maxConsecutive = Number(maxConsecutiveDays);
  if (!Number.isInteger(maxConsecutive) || maxConsecutive <= 0) {
    return { success: false, error: '連続勤務日数は1以上の整数で指定してください。' };
  }

  const requirements = Array.from({ length: 24 }, (_, hour) => {
    const value = Number((hourlyRequirements || [])[hour] || 0);
    if (!Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
      throw new Error('時間ごとの必要人数は0以上の整数で指定してください。');
    }
    return value;
  });

  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const totalDays = daysInMonth(year, monthIndex);

  const patternMap = new Map();
  for (const pattern of patterns) {
    const weeklyLimit = Number(pattern.maxPerWeek);
    if (!pattern.id || !pattern.name || !Number.isInteger(weeklyLimit) || weeklyLimit <= 0) {
      return { success: false, error: '勤務体系の入力内容が不正です。' };
    }

    const hours = buildHourRange(pattern.startHour, pattern.endHour);
    const hourSet = new Set(hours);
    const score = hours.reduce((sum, hour) => sum + requirements[hour], 0);
    patternMap.set(pattern.id, { ...pattern, maxPerWeek: weeklyLimit, hours, hourSet, score });
  }

  const preparedWorkers = workers.map((worker) => {
    const patternIds = normalizeWorkerPatternIds(worker);
    const workerPatterns = patternIds.map((id) => patternMap.get(id)).filter(Boolean);

    if (!worker.name || workerPatterns.length === 0) {
      throw new Error('勤務者の入力内容が不正です。');
    }

    return {
      name: worker.name,
      patterns: workerPatterns
    };
  });

  const assignments = Array.from({ length: totalDays }, () => []);
  const initialState = createInitialState(preparedWorkers);

  const startTime = Date.now();
  const timeBudget = Number(timeBudgetMs) > 0 ? Number(timeBudgetMs) : DEFAULT_TIME_BUDGET_MS;
  let timedOut = false;
  let stepCount = 0;

  function isOutOfBudget() {
    if (timedOut) {
      return true;
    }
    stepCount += 1;
    if (stepCount % 500 === 0 && Date.now() - startTime > timeBudget) {
      timedOut = true;
    }
    return timedOut;
  }

  function assignDay(dayIndex, state) {
    if (dayIndex >= totalDays) {
      return true;
    }

    if (isOutOfBudget()) {
      return false;
    }

    const weekKey = Math.floor(dayIndex / 7);
    const eligibleWorkers = preparedWorkers.map((worker) => {
      const name = worker.name;
      if (state.forcedOffDays[name].has(dayIndex)) {
        return null;
      }

      if (state.consecutive[name] >= maxConsecutive) {
        return null;
      }

      const availablePatterns = worker.patterns.filter((pattern) => {
        const patternCount = getPatternCount(state, name, weekKey, pattern.id);
        return patternCount < pattern.maxPerWeek;
      });

      if (availablePatterns.length === 0) {
        return null;
      }

      const maxScore = Math.max(...availablePatterns.map((pattern) => pattern.score));

      return {
        name,
        availablePatterns,
        maxScore
      };
    }).filter(Boolean);

    eligibleWorkers.sort((a, b) => b.maxScore - a.maxScore);

    const coverage = Array(24).fill(0);

    function canStillMeetWithRemainingWorkers(startIndex) {
      for (let hour = 0; hour < 24; hour += 1) {
        const need = Math.max(0, requirements[hour] - coverage[hour]);
        if (need === 0) {
          continue;
        }

        let possible = 0;
        for (let i = startIndex; i < eligibleWorkers.length; i += 1) {
          if (eligibleWorkers[i].availablePatterns.some((pattern) => pattern.hourSet.has(hour))) {
            possible += 1;
          }
        }

        if (possible < need) {
          return false;
        }
      }
      return true;
    }

    function tryChoose(workerIndex, chosen) {
      if (isOutOfBudget()) {
        return false;
      }

      if (allRequirementsMet(requirements, coverage)) {
        const nextState = cloneState(state, preparedWorkers);
        const chosenMap = new Map(chosen.map((item) => [item.name, item.pattern]));

        for (const worker of preparedWorkers) {
          const name = worker.name;
          const chosenPattern = chosenMap.get(name);
          if (chosenPattern) {
            nextState.consecutive[name] = state.consecutive[name] + 1;
            const weekCounts = nextState.weeklyCounts[name][weekKey] || {};
            weekCounts[chosenPattern.id] = (weekCounts[chosenPattern.id] || 0) + 1;
            nextState.weeklyCounts[name][weekKey] = weekCounts;

            if (isOvernight(chosenPattern)) {
              const forcedOffDay = dayIndex + 2;
              if (forcedOffDay < totalDays) {
                nextState.forcedOffDays[name].add(forcedOffDay);
              }
            }
          } else {
            nextState.consecutive[name] = 0;
          }
        }

        assignments[dayIndex] = chosen.map((item) => ({
          name: item.name,
          patternName: item.pattern.name
        }));
        if (assignDay(dayIndex + 1, nextState)) {
          return true;
        }
        assignments[dayIndex] = [];
        return false;
      }

      if (workerIndex >= eligibleWorkers.length) {
        return false;
      }

      if (!canStillMeetWithRemainingWorkers(workerIndex)) {
        return false;
      }

      if (tryChoose(workerIndex + 1, chosen)) {
        return true;
      }

      const worker = eligibleWorkers[workerIndex];
      const sortedPatterns = [...worker.availablePatterns].sort((a, b) => b.score - a.score);

      for (const pattern of sortedPatterns) {
        for (const hour of pattern.hours) {
          coverage[hour] += 1;
        }

        chosen.push({ name: worker.name, pattern });
        if (tryChoose(workerIndex + 1, chosen)) {
          return true;
        }
        chosen.pop();

        for (const hour of pattern.hours) {
          coverage[hour] -= 1;
        }
      }

      return false;
    }

    return tryChoose(0, []);
  }

  const success = assignDay(0, initialState);
  if (!success) {
    if (timedOut) {
      return {
        success: false,
        error: '計算に時間がかかりすぎたため処理を中断しました。条件を見直すか、勤務者数や期間を減らしてください。'
      };
    }
    return {
      success: false,
      error: '条件を満たすシフト表を作成できませんでした。条件を見直してください。'
    };
  }

  const detailedAssignments = assignments.map((names, index) => {
    const day = index + 1;
    return {
      day,
      date: `${month}-${String(day).padStart(2, '0')}`,
      workers: names.map((item) => item.name),
      shifts: names
    };
  });

  return {
    success: true,
    month,
    assignments: detailedAssignments
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    buildHourRange,
    generateSchedule
  };
}

if (typeof window !== 'undefined') {
  window.AutoShiftScheduler = {
    buildHourRange,
    generateSchedule
  };
}
