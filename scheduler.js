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

function fillHourlyRequirements(rawValues) {
  const values = Array.isArray(rawValues) ? rawValues : [];
  let previousValue = 0;

  return Array.from({ length: 24 }, (_, hour) => {
    const raw = values[hour];
    const trimmed = raw === undefined || raw === null ? '' : String(raw).trim();

    if (trimmed === '') {
      return previousValue;
    }

    const value = Number(trimmed);
    previousValue = Number.isFinite(value) ? value : previousValue;
    return previousValue;
  });
}

function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function createInitialState(workers) {
  const consecutive = {};
  const weeklyCounts = {};
  const forcedOffDays = {};
  const workCounts = {};

  for (const worker of workers) {
    consecutive[worker.name] = 0;
    weeklyCounts[worker.name] = {};
    forcedOffDays[worker.name] = new Set();
    workCounts[worker.name] = 0;
  }

  return { consecutive, weeklyCounts, forcedOffDays, workCounts };
}

function cloneState(state, workers) {
  const next = {
    consecutive: {},
    weeklyCounts: {},
    forcedOffDays: {},
    workCounts: {}
  };

  for (const worker of workers) {
    const name = worker.name;
    next.consecutive[name] = state.consecutive[name];
    next.weeklyCounts[name] = {};
    for (const [weekKey, patternCounts] of Object.entries(state.weeklyCounts[name])) {
      next.weeklyCounts[name][weekKey] = { ...patternCounts };
    }
    next.forcedOffDays[name] = new Set(state.forcedOffDays[name]);
    next.workCounts[name] = state.workCounts[name];
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

  const preparedWorkers = workers.map((worker, workerIndex) => {
    const patternIds = normalizeWorkerPatternIds(worker);
    const workerPatterns = patternIds.map((id) => patternMap.get(id)).filter(Boolean);

    if (!worker.name || workerPatterns.length === 0) {
      throw new Error('勤務者の入力内容が不正です。');
    }

    const rawRequiredDaysOff = worker.requiredDaysOff;
    const requiredDaysOff = rawRequiredDaysOff === undefined || rawRequiredDaysOff === null || rawRequiredDaysOff === ''
      ? null
      : Number(rawRequiredDaysOff);
    if (requiredDaysOff !== null && (!Number.isInteger(requiredDaysOff) || requiredDaysOff < 0 || requiredDaysOff > totalDays)) {
      throw new Error('公休日数は対象月の日数以下の0以上の整数で指定してください。');
    }

    return {
      name: worker.name,
      patterns: workerPatterns,
      targetWorkDays: requiredDaysOff === null ? null : totalDays - requiredDaysOff,
      scheduleOffset: (4 * workerIndex * workerIndex + 12 * workerIndex) % totalDays
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
      return preparedWorkers.every((worker) =>
        worker.targetWorkDays === null || state.workCounts[worker.name] === worker.targetWorkDays
      );
    }

    if (isOutOfBudget()) {
      return false;
    }

    const weekKey = Math.floor(dayIndex / 7);
    const remainingDays = totalDays - dayIndex;
    let impossible = false;
    const eligibleWorkers = preparedWorkers.map((worker) => {
      const name = worker.name;
      const workCount = state.workCounts[name];
      const forcedOffDaysRemaining = [...state.forcedOffDays[name]]
        .filter((forcedDay) => forcedDay >= dayIndex).length;
      const availableRemainingDays = remainingDays - forcedOffDaysRemaining;
      const isForcedOffToday = state.forcedOffDays[name].has(dayIndex);
      const mustWorkToday = !isForcedOffToday && worker.targetWorkDays !== null
        && workCount + availableRemainingDays === worker.targetWorkDays;

      if (worker.targetWorkDays !== null
        && (workCount > worker.targetWorkDays || workCount + availableRemainingDays < worker.targetWorkDays)) {
        impossible = true;
        return null;
      }

      if (worker.targetWorkDays !== null && workCount >= worker.targetWorkDays) {
        return null;
      }

      if (isForcedOffToday) {
        return null;
      }

      if (state.consecutive[name] >= maxConsecutive) {
        impossible ||= mustWorkToday;
        return null;
      }

      const availablePatterns = worker.patterns.filter((pattern) => {
        const patternCount = getPatternCount(state, name, weekKey, pattern.id);
        return patternCount < pattern.maxPerWeek;
      });

      if (availablePatterns.length === 0) {
        impossible ||= mustWorkToday;
        return null;
      }

      const maxScore = Math.max(...availablePatterns.map((pattern) => pattern.score));

      return {
        name,
        availablePatterns,
        maxScore,
        mustWorkToday,
        targetWorkDays: worker.targetWorkDays,
        scheduleOffset: worker.scheduleOffset,
        preferWork: worker.targetWorkDays !== null
          && ((dayIndex + worker.scheduleOffset) * worker.targetWorkDays) % totalDays < worker.targetWorkDays
      };
    }).filter(Boolean);

    if (impossible) {
      return false;
    }

    eligibleWorkers.sort((a, b) =>
      Number(b.mustWorkToday) - Number(a.mustWorkToday)
      || Number(b.preferWork) - Number(a.preferWork)
      || b.maxScore - a.maxScore
    );

    const usesMonthlyDaysOff = preparedWorkers.every((worker) => worker.targetWorkDays !== null);
    if (usesMonthlyDaysOff) {
      const candidates = [];

      function collectCandidates(workerIndex, chosenWorkers, penalty) {
        if (workerIndex >= eligibleWorkers.length) {
          candidates.push({ workers: [...chosenWorkers], penalty });
          return;
        }

        const worker = eligibleWorkers[workerIndex];
        if (!worker.mustWorkToday) {
          collectCandidates(
            workerIndex + 1,
            chosenWorkers,
            penalty + (worker.preferWork ? 1 : 0)
          );
        }

        chosenWorkers.push(worker);
        collectCandidates(
          workerIndex + 1,
          chosenWorkers,
          penalty + (worker.preferWork ? 0 : 1)
        );
        chosenWorkers.pop();
      }

      collectCandidates(0, [], 0);
      candidates.sort((a, b) => a.penalty - b.penalty || a.workers.length - b.workers.length);

      function assignPatterns(workersForDay) {
        const dailyCoverage = Array(24).fill(0);
        const chosen = [];

        function choosePattern(remainingWorkers) {
          if (isOutOfBudget()) {
            return null;
          }
          if (remainingWorkers.length === 0) {
            return allRequirementsMet(requirements, dailyCoverage) ? [...chosen] : null;
          }
          if (!canStillMeetRequirements(
            requirements,
            dailyCoverage,
            remainingWorkers.map((worker) => ({
              hours: [...new Set(worker.availablePatterns.flatMap((pattern) => pattern.hours))]
            }))
          )) {
            return null;
          }

          const unmetHours = requirements
            .map((required, hour) => ({ hour, deficit: required - dailyCoverage[hour] }))
            .filter((item) => item.deficit > 0);
          let candidatePairs;
          if (unmetHours.length === 0) {
            const worker = [...remainingWorkers].sort((a, b) =>
              a.availablePatterns.length - b.availablePatterns.length
            )[0];
            candidatePairs = worker.availablePatterns.map((pattern) => ({ worker, pattern }));
          } else {
            const targetHour = unmetHours.sort((a, b) => {
              const optionCount = (item) => remainingWorkers.reduce(
                (count, worker) => count + worker.availablePatterns.filter((pattern) => pattern.hourSet.has(item.hour)).length,
                0
              );
              return optionCount(a) - optionCount(b) || b.deficit - a.deficit;
            })[0].hour;
            candidatePairs = remainingWorkers.flatMap((worker) =>
              worker.availablePatterns
                .filter((pattern) => pattern.hourSet.has(targetHour))
                .map((pattern) => ({ worker, pattern }))
            );
          }

          const marginalScore = (pattern) => pattern.hours.reduce(
            (score, hour) => score + Math.max(0, requirements[hour] - dailyCoverage[hour]),
            0
          );
          candidatePairs.sort((a, b) => {
            const futureOffScore = ({ worker, pattern }) => {
              if (!isOvernight(pattern)) return 0;
              const overnightNeeded = requirements.some((required, hour) =>
                (hour < 7 || hour >= 20) && dailyCoverage[hour] < required
              );
              if (!overnightNeeded) return -1;
              const futureDay = dayIndex + 2;
              if (futureDay >= totalDays) return 1;
              const plannedWork = ((futureDay + worker.scheduleOffset) * worker.targetWorkDays) % totalDays
                < worker.targetWorkDays;
              return plannedWork ? 0 : 2;
            };
            return futureOffScore(b) - futureOffScore(a)
              || marginalScore(b.pattern) - marginalScore(a.pattern)
              || a.worker.availablePatterns.length - b.worker.availablePatterns.length;
          });

          for (const { worker, pattern } of candidatePairs) {
            for (const hour of pattern.hours) dailyCoverage[hour] += 1;
            chosen.push({ name: worker.name, pattern });
            const result = choosePattern(remainingWorkers.filter((item) => item !== worker));
            if (result) return result;
            chosen.pop();
            for (const hour of pattern.hours) dailyCoverage[hour] -= 1;
          }
          return null;
        }

        return choosePattern(workersForDay);
      }

      for (const candidate of candidates) {
        if (isOutOfBudget()) return false;
        const chosen = assignPatterns(candidate.workers);
        if (!chosen) continue;

        const nextState = cloneState(state, preparedWorkers);
        const chosenMap = new Map(chosen.map((item) => [item.name, item.pattern]));
        for (const worker of preparedWorkers) {
          const name = worker.name;
          const chosenPattern = chosenMap.get(name);
          if (chosenPattern) {
            nextState.consecutive[name] = state.consecutive[name] + 1;
            nextState.workCounts[name] = state.workCounts[name] + 1;
            const weekCounts = nextState.weeklyCounts[name][weekKey] || {};
            weekCounts[chosenPattern.id] = (weekCounts[chosenPattern.id] || 0) + 1;
            nextState.weeklyCounts[name][weekKey] = weekCounts;
            if (isOvernight(chosenPattern)) {
              const forcedOffDay = dayIndex + 2;
              if (forcedOffDay < totalDays) nextState.forcedOffDays[name].add(forcedOffDay);
            }
          } else {
            nextState.consecutive[name] = 0;
          }
        }

        const daysAfterToday = totalDays - dayIndex - 1;
        const targetsRemainPossible = preparedWorkers.every((worker) => {
          const count = nextState.workCounts[worker.name];
          const forcedDaysAfterToday = [...nextState.forcedOffDays[worker.name]]
            .filter((forcedDay) => forcedDay > dayIndex).length;
          return count <= worker.targetWorkDays
            && count + daysAfterToday - forcedDaysAfterToday >= worker.targetWorkDays;
        });
        if (!targetsRemainPossible) continue;

        assignments[dayIndex] = chosen.map((item) => ({
          name: item.name,
          patternName: item.pattern.name
        }));
        if (assignDay(dayIndex + 1, nextState)) return true;
        assignments[dayIndex] = [];
      }

      return false;
    }

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

      function tryNextDay() {
        const nextState = cloneState(state, preparedWorkers);
        const chosenMap = new Map(chosen.map((item) => [item.name, item.pattern]));

        for (const worker of preparedWorkers) {
          const name = worker.name;
          const chosenPattern = chosenMap.get(name);
          if (chosenPattern) {
            nextState.consecutive[name] = state.consecutive[name] + 1;
            nextState.workCounts[name] = state.workCounts[name] + 1;
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

        const daysAfterToday = totalDays - dayIndex - 1;
        const targetsRemainPossible = preparedWorkers.every((worker) => {
          if (worker.targetWorkDays === null) {
            return true;
          }
          const count = nextState.workCounts[worker.name];
          const forcedDaysAfterToday = [...nextState.forcedOffDays[worker.name]]
            .filter((forcedDay) => forcedDay > dayIndex).length;
          return count <= worker.targetWorkDays
            && count + daysAfterToday - forcedDaysAfterToday >= worker.targetWorkDays;
        });
        if (!targetsRemainPossible) {
          return false;
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

      const requirementsMet = allRequirementsMet(requirements, coverage);
      const remainingPreferredWorker = eligibleWorkers
        .slice(workerIndex)
        .some((worker) => worker.mustWorkToday || worker.preferWork);
      if (requirementsMet && !remainingPreferredWorker && tryNextDay()) {
        return true;
      }

      if (workerIndex >= eligibleWorkers.length) {
        return requirementsMet && tryNextDay();
      }

      if (!requirementsMet && !canStillMeetWithRemainingWorkers(workerIndex)) {
        return false;
      }

      const worker = eligibleWorkers[workerIndex];
      const sortedPatterns = [...worker.availablePatterns].sort((a, b) => b.score - a.score);

      function tryWorking() {
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

      if (worker.mustWorkToday || worker.preferWork) {
        if (tryWorking()) {
          return true;
        }
        if (!worker.mustWorkToday && tryChoose(workerIndex + 1, chosen)) {
          return true;
        }
      } else {
        if (tryChoose(workerIndex + 1, chosen) || tryWorking()) {
          return true;
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
    fillHourlyRequirements,
    generateSchedule
  };
}

if (typeof window !== 'undefined') {
  window.AutoShiftScheduler = {
    buildHourRange,
    fillHourlyRequirements,
    generateSchedule
  };
}
