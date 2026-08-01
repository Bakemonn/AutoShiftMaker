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
    next.weeklyCounts[name] = { ...state.weeklyCounts[name] };
    next.forcedOffDays[name] = new Set(state.forcedOffDays[name]);
  }

  return next;
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

function generateSchedule(input) {
  const {
    month,
    workers,
    patterns,
    hourlyRequirements,
    maxConsecutiveDays
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
    patternMap.set(pattern.id, { ...pattern, maxPerWeek: weeklyLimit, hours });
  }

  const preparedWorkers = workers.map((worker) => {
    const pattern = patternMap.get(worker.patternId);
    if (!worker.name || !pattern) {
      throw new Error('勤務者の入力内容が不正です。');
    }
    return {
      name: worker.name,
      patternId: worker.patternId,
      pattern,
      hours: pattern.hours
    };
  });

  const assignments = Array.from({ length: totalDays }, () => []);
  const initialState = createInitialState(preparedWorkers);

  function assignDay(dayIndex, state) {
    if (dayIndex >= totalDays) {
      return true;
    }

    const weekKey = Math.floor(dayIndex / 7);
    const eligibleWorkers = preparedWorkers.filter((worker) => {
      const name = worker.name;
      if (state.forcedOffDays[name].has(dayIndex)) {
        return false;
      }

      if (state.consecutive[name] >= maxConsecutive) {
        return false;
      }

      const weeklyCount = state.weeklyCounts[name][weekKey] || 0;
      return weeklyCount < worker.pattern.maxPerWeek;
    });

    eligibleWorkers.sort((a, b) => {
      const aScore = a.hours.reduce((score, hour) => score + requirements[hour], 0);
      const bScore = b.hours.reduce((score, hour) => score + requirements[hour], 0);
      return bScore - aScore;
    });

    const coverage = Array(24).fill(0);

    function tryChoose(workerIndex, chosen) {
      if (allRequirementsMet(requirements, coverage)) {
        const nextState = cloneState(state, preparedWorkers);
        const chosenSet = new Set(chosen.map((worker) => worker.name));

        for (const worker of preparedWorkers) {
          const name = worker.name;
          if (chosenSet.has(name)) {
            nextState.consecutive[name] = state.consecutive[name] + 1;
            const count = nextState.weeklyCounts[name][weekKey] || 0;
            nextState.weeklyCounts[name][weekKey] = count + 1;

            if (isOvernight(worker.pattern)) {
              const forcedOffDay = dayIndex + 2;
              if (forcedOffDay < totalDays) {
                nextState.forcedOffDays[name].add(forcedOffDay);
              }
            }
          } else {
            nextState.consecutive[name] = 0;
          }
        }

        assignments[dayIndex] = chosen.map((worker) => worker.name);
        if (assignDay(dayIndex + 1, nextState)) {
          return true;
        }
        assignments[dayIndex] = [];
        return false;
      }

      if (workerIndex >= eligibleWorkers.length) {
        return false;
      }

      const remainingWorkers = eligibleWorkers.slice(workerIndex);
      if (!canStillMeetRequirements(requirements, coverage, remainingWorkers)) {
        return false;
      }

      if (tryChoose(workerIndex + 1, chosen)) {
        return true;
      }

      const worker = eligibleWorkers[workerIndex];
      for (const hour of worker.hours) {
        coverage[hour] += 1;
      }

      chosen.push(worker);
      if (tryChoose(workerIndex + 1, chosen)) {
        return true;
      }
      chosen.pop();

      for (const hour of worker.hours) {
        coverage[hour] -= 1;
      }

      return false;
    }

    return tryChoose(0, []);
  }

  const success = assignDay(0, initialState);
  if (!success) {
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
      workers: names
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
