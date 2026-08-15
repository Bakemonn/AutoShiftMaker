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

const QUARTERS_PER_HOUR = 4;
const QUARTERS_PER_DAY = 24 * QUARTERS_PER_HOUR;

function toQuarterIndex(hour, minute = 0) {
  const normalizedHour = Number(hour);
  const normalizedMinute = Number(minute || 0);
  if (!Number.isInteger(normalizedHour) || normalizedHour < 0 || normalizedHour > 23
    || !Number.isInteger(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59
    || normalizedMinute % 15 !== 0) {
    throw new Error('勤務時刻は0〜23時、0・15・30・45分で指定してください。');
  }
  return normalizedHour * QUARTERS_PER_HOUR + normalizedMinute / 15;
}

function buildQuarterRange(pattern) {
  const start = toQuarterIndex(pattern.startHour, pattern.startMinute);
  const end = toQuarterIndex(pattern.endHour, pattern.endMinute);
  const working = new Set();
  let quarter = start;

  do {
    working.add(quarter);
    quarter = (quarter + 1) % QUARTERS_PER_DAY;
  } while (quarter !== end);

  for (const rest of pattern.breaks || []) {
    const breakStart = toQuarterIndex(rest.startHour, rest.startMinute);
    const breakEnd = toQuarterIndex(rest.endHour, rest.endMinute);
    let breakQuarter = breakStart;
    do {
      working.delete(breakQuarter);
      breakQuarter = (breakQuarter + 1) % QUARTERS_PER_DAY;
    } while (breakQuarter !== breakEnd);
  }

  return [...working];
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
  const dayMarkers = {};
  const workCounts = {};
  const previousPatterns = {};
  const consecutiveNightDuties = {};
  const shiftCounts = {};

  for (const worker of workers) {
    consecutive[worker.name] = 0;
    dayMarkers[worker.name] = new Map((worker.requestedDaysOff || []).map((day) => [day, '希望休']));
    workCounts[worker.name] = 0;
    previousPatterns[worker.name] = null;
    consecutiveNightDuties[worker.name] = 0;
    shiftCounts[worker.name] = { mrL: 0, ichi: 0 };
  }

  return { consecutive, dayMarkers, workCounts, previousPatterns, consecutiveNightDuties, shiftCounts };
}

function cloneState(state, workers) {
  const next = {
    consecutive: {},
    dayMarkers: {},
    workCounts: {},
    previousPatterns: {},
    consecutiveNightDuties: {},
    shiftCounts: {}
  };

  for (const worker of workers) {
    const name = worker.name;
    next.consecutive[name] = state.consecutive[name];
    next.dayMarkers[name] = new Map(state.dayMarkers[name]);
    next.workCounts[name] = state.workCounts[name];
    next.previousPatterns[name] = state.previousPatterns[name];
    next.consecutiveNightDuties[name] = state.consecutiveNightDuties[name];
    next.shiftCounts[name] = { ...state.shiftCounts[name] };
  }

  return next;
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
  for (let hour = 0; hour < requirements.length; hour += 1) {
    if ((coverage[hour] || 0) < (requirements[hour] || 0)) {
      return false;
    }
  }
  return true;
}

function canStillMeetRequirements(requirements, coverage, remainingWorkers) {
  for (let hour = 0; hour < requirements.length; hour += 1) {
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
  const start = Number(pattern.startHour) * 60 + Number(pattern.startMinute || 0);
  const end = Number(pattern.endHour) * 60 + Number(pattern.endMinute || 0);
  return end <= start;
}

function buildPreferredWorkDays(totalDays, targetWorkDays, requestedDaysOff, workerIndex) {
  if (targetWorkDays === null) return null;
  const requestedOffDays = new Set(requestedDaysOff);
  const scheduleOffset = (4 * workerIndex * workerIndex + 12 * workerIndex) % totalDays;
  const workDays = new Set(Array.from({ length: totalDays }, (_, day) => day).filter((day) =>
    ((day + scheduleOffset) * targetWorkDays) % totalDays < targetWorkDays
    && !requestedOffDays.has(day)
  ));

  function longestWorkRun(candidateWorkDays) {
    let longest = 0;
    let current = 0;
    for (let day = 0; day < totalDays; day += 1) {
      if (candidateWorkDays.has(day)) {
        current += 1;
        longest = Math.max(longest, current);
      } else {
        current = 0;
      }
    }
    return longest;
  }

  while (workDays.size < targetWorkDays) {
    const candidates = [];
    for (let day = 0; day < totalDays; day += 1) {
      if (workDays.has(day) || requestedOffDays.has(day)) continue;
      const nextWorkDays = new Set(workDays);
      nextWorkDays.add(day);
      candidates.push({
        day,
        longestRun: longestWorkRun(nextWorkDays),
        tieBreaker: (day + scheduleOffset) % totalDays
      });
    }
    candidates.sort((a, b) =>
      a.longestRun - b.longestRun
      || a.tieBreaker - b.tieBreaker
    );
    workDays.add(candidates[0].day);
  }

  while (workDays.size > targetWorkDays) {
    const candidates = [...workDays].map((day) => {
      const nextWorkDays = new Set(workDays);
      nextWorkDays.delete(day);
      return {
        day,
        longestRun: longestWorkRun(nextWorkDays),
        tieBreaker: (day + scheduleOffset) % totalDays
      };
    });
    candidates.sort((a, b) => a.longestRun - b.longestRun || b.tieBreaker - a.tieBreaker);
    workDays.delete(candidates[0].day);
  }

  return workDays;
}

const DEFAULT_TIME_BUDGET_MS = 8000;
const MAX_CONSECUTIVE_DAYS = 4;
const NIGHT_PATTERN_NAMES = new Set(['①', '夜', '③']);
const MRL_PATTERN_NAMES = new Set(['M', 'R', 'L']);
const FORBIDDEN_PATTERN_TRANSITIONS = new Map([
  ['E', new Set(['D', 'A', 'R', 'L'])],
  ['M', new Set(['D', 'A'])]
]);

function getPatternDayMarkers(pattern, dayIndex, totalDays) {
  const markers = [];
  const addMarker = (offset, marker) => {
    const targetDay = dayIndex + offset;
    if (targetDay < totalDays) markers.push({ day: targetDay, marker });
  };

  if (pattern.name === '①' || pattern.name === '夜') {
    addMarker(1, '明');
    addMarker(2, '公夜後');
  } else if (pattern.name === '③') {
    addMarker(1, '明');
  } else if (pattern.nextDayOff) {
    addMarker(1, '公');
  }
  return markers;
}

function markersConflict(existingMarker, nextMarker) {
  if (!existingMarker) return false;
  return (existingMarker === '明') !== (nextMarker === '明');
}

function setDayMarker(markerMap, day, marker) {
  const existing = markerMap.get(day);
  if (markersConflict(existing, marker)) return false;
  if (!existing || marker === '公夜後') markerMap.set(day, marker);
  return true;
}

function isPatternTransitionAllowed(previousPattern, nextPattern) {
  if (MRL_PATTERN_NAMES.has(previousPattern) && MRL_PATTERN_NAMES.has(nextPattern)) return false;
  return !FORBIDDEN_PATTERN_TRANSITIONS.get(previousPattern)?.has(nextPattern);
}

function canAssignNightPattern(patternName, consecutiveNightDuties) {
  return !NIGHT_PATTERN_NAMES.has(patternName) || consecutiveNightDuties < 2;
}

function hasBalancedShiftCounts(counts) {
  return counts.mrL === counts.ichi;
}

function getMaximumFutureWorkDays(markerMap, startDay, totalDays, initialConsecutive) {
  let states = new Map([[initialConsecutive, 0]]);
  for (let day = startDay; day < totalDays; day += 1) {
    const marker = markerMap.get(day);
    const nextStates = new Map();
    const keepMaximum = (consecutive, workDays) => {
      nextStates.set(consecutive, Math.max(nextStates.get(consecutive) ?? -Infinity, workDays));
    };

    for (const [consecutive, workDays] of states) {
      if (marker === '明') {
        if (consecutive < MAX_CONSECUTIVE_DAYS) keepMaximum(consecutive + 1, workDays + 1);
      } else if (marker) {
        keepMaximum(0, workDays);
      } else {
        keepMaximum(0, workDays);
        if (consecutive < MAX_CONSECUTIVE_DAYS) keepMaximum(consecutive + 1, workDays + 1);
      }
    }
    states = nextStates;
    if (states.size === 0) return -Infinity;
  }
  return Math.max(...states.values());
}

function generateSchedule(input) {
  const {
    month,
    workers,
    patterns,
    hourlyRequirements,
    absenceRules,
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

  const requirements = Array.from({ length: QUARTERS_PER_DAY }, (_, quarter) => {
    const value = Number((hourlyRequirements || [])[Math.floor(quarter / QUARTERS_PER_HOUR)] || 0);
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
    if (!pattern.id || !pattern.name) {
      return { success: false, error: '勤務体系の入力内容が不正です。' };
    }

    let hours;
    try {
      hours = buildQuarterRange(pattern);
    } catch (error) {
      return { success: false, error: error.message };
    }
    const hourSet = new Set(hours);
    const score = hours.reduce((sum, hour) => sum + requirements[hour], 0);
    patternMap.set(pattern.id, {
      ...pattern,
      nextDayOff: Boolean(pattern.nextDayOff),
      hours,
      hourSet,
      score
    });
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
    const requestedDaysOff = [...new Set(worker.requestedDaysOff || [])];
    if (requestedDaysOff.some((day) => !Number.isInteger(day) || day < 1 || day > totalDays)) {
      throw new Error('希望休は対象月内の日付で指定してください。');
    }
    if (requiredDaysOff !== null && requestedDaysOff.length > requiredDaysOff) {
      throw new Error('希望休は月間公休日数以下の日数で指定してください。');
    }

    return {
      name: worker.name,
      patterns: workerPatterns,
      targetWorkDays: requiredDaysOff === null ? null : totalDays - requiredDaysOff,
      requestedDaysOff: requestedDaysOff.map((day) => day - 1),
      preferredWorkDays: requestedDaysOff.length === 0
        ? null
        : buildPreferredWorkDays(
          totalDays,
          requiredDaysOff === null ? null : totalDays - requiredDaysOff,
          requestedDaysOff.map((day) => day - 1),
          workerIndex
        ),
      scheduleOffset: (4 * workerIndex * workerIndex + 12 * workerIndex) % totalDays
    };
  });

  const workerNameSet = new Set(preparedWorkers.map((worker) => worker.name));
  const preparedAbsenceRules = [];
  for (const [ruleIndex, rule] of (absenceRules || []).entries()) {
    const workerNames = Array.isArray(rule.workerNames)
      ? [...new Set(rule.workerNames.filter((name) => workerNameSet.has(name)))]
      : [];
    const dateMatch = typeof rule.date === 'string' && rule.date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const startMatch = typeof rule.startTime === 'string' && rule.startTime.match(/^(\d{2}):(\d{2})$/);
    const endMatch = typeof rule.endTime === 'string' && rule.endTime.match(/^(\d{2}):(\d{2})$/);
    if (workerNames.length === 0 || !dateMatch || !startMatch || !endMatch || rule.date.slice(0, 7) !== month) {
      return { success: false, error: '勤務人数対象外時間の入力内容が不正です。' };
    }

    const day = Number(dateMatch[3]);
    let startQuarter;
    let endQuarter;
    try {
      startQuarter = toQuarterIndex(Number(startMatch[1]), Number(startMatch[2]));
      endQuarter = toQuarterIndex(Number(endMatch[1]), Number(endMatch[2]));
    } catch (_error) {
      return { success: false, error: '勤務人数対象外時間は15分単位で指定してください。' };
    }
    if (day < 1 || day > totalDays || startQuarter >= endQuarter) {
      return { success: false, error: '勤務人数対象外の日付または時間帯が不正です。' };
    }

    preparedAbsenceRules.push({
      id: rule.id || `absence-${ruleIndex}`,
      dayIndex: day - 1,
      workerNames,
      startTime: rule.startTime,
      endTime: rule.endTime,
      hours: Array.from({ length: endQuarter - startQuarter }, (_, offset) => startQuarter + offset)
    });
  }

  const assignments = Array.from({ length: totalDays }, () => []);
  const absenceAssignments = Array.from({ length: totalDays }, () => []);
  const dayStatuses = Array.from({ length: totalDays }, () => []);
  const initialState = createInitialState(preparedWorkers);

  const startTime = Date.now();
  const timeBudget = Number(timeBudgetMs) > 0 ? Number(timeBudgetMs) : DEFAULT_TIME_BUDGET_MS;
  let timedOut = false;
  let stepCount = 0;
  let furthestDay = 0;
  let furthestSnapshot = null;
  const failedStates = Array.from({ length: totalDays }, () => new Set());

  function buildStateKey(dayIndex, state) {
    return preparedWorkers.map((worker) => {
      const name = worker.name;
      const markers = [...state.dayMarkers[name].entries()]
        .filter(([day]) => day >= dayIndex)
        .map(([day, marker]) => `${day}:${marker}`)
        .join(',');
      const counts = state.shiftCounts[name];
      return [
        state.consecutive[name],
        state.workCounts[name],
        state.previousPatterns[name] || '',
        state.consecutiveNightDuties[name],
        counts.mrL,
        counts.ichi,
        markers
      ].join(':');
    }).join('|');
  }

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
    if (dayIndex > furthestDay) {
      furthestDay = dayIndex;
      furthestSnapshot = preparedWorkers.map((worker) => ({
        name: worker.name,
        workCount: state.workCounts[worker.name],
        targetWorkDays: worker.targetWorkDays,
        consecutive: state.consecutive[worker.name],
        nightDuties: state.consecutiveNightDuties[worker.name],
        shiftCounts: { ...state.shiftCounts[worker.name] },
        futureMarkers: [...state.dayMarkers[worker.name].entries()]
          .filter(([markerDay]) => markerDay >= dayIndex)
      }));
    }
    if (dayIndex >= totalDays) {
      return preparedWorkers.every((worker) =>
        (worker.targetWorkDays === null || state.workCounts[worker.name] === worker.targetWorkDays)
        && hasBalancedShiftCounts(state.shiftCounts[worker.name])
      );
    }

    if (isOutOfBudget()) {
      return false;
    }
    const stateKey = buildStateKey(dayIndex, state);
    if (failedStates[dayIndex].has(stateKey)) return false;

    function resolveDailyAbsences(chosen) {
      const rulesForDay = preparedAbsenceRules.filter((rule) => rule.dayIndex === dayIndex);
      if (rulesForDay.length === 0) {
        const coverage = Array(requirements.length).fill(0);
        for (const item of chosen) {
          for (const hour of item.pattern.hours) coverage[hour] += 1;
        }
        return allRequirementsMet(requirements, coverage) ? [] : null;
      }

      function chooseAbsentWorker(ruleIndex, selected) {
        if (ruleIndex >= rulesForDay.length) {
          const coverage = Array(requirements.length).fill(0);
          const absentHoursByWorker = new Map();
          for (const item of selected) {
            const hours = absentHoursByWorker.get(item.name) || new Set();
            for (const hour of item.rule.hours) hours.add(hour);
            absentHoursByWorker.set(item.name, hours);
          }
          for (const item of chosen) {
            const absentHours = absentHoursByWorker.get(item.name) || new Set();
            for (const hour of item.pattern.hours) {
              if (!absentHours.has(hour)) coverage[hour] += 1;
            }
          }
          return allRequirementsMet(requirements, coverage)
            ? selected.map((item) => ({
              ruleId: item.rule.id,
              name: item.name,
              startTime: item.rule.startTime,
              endTime: item.rule.endTime
            }))
            : null;
        }

        const rule = rulesForDay[ruleIndex];
        const candidates = chosen.filter((item) =>
          rule.workerNames.includes(item.name)
          && rule.hours.every((hour) => item.pattern.hourSet.has(hour))
        );
        for (const candidate of candidates) {
          selected.push({ rule, name: candidate.name });
          const result = chooseAbsentWorker(ruleIndex + 1, selected);
          if (result) return result;
          selected.pop();
        }
        return null;
      }

      return chooseAbsentWorker(0, []);
    }

    function shiftBalancePenalty(workerName, patternName) {
      const counts = state.shiftCounts[workerName];
      const nextMrL = counts.mrL + Number(MRL_PATTERN_NAMES.has(patternName));
      const nextIchi = counts.ichi + Number(patternName === '①');
      return Math.abs(nextMrL - nextIchi);
    }

    function patternMarkerPenalty(worker, pattern) {
      if (worker.targetWorkDays === null) return 0;
      return getPatternDayMarkers(pattern, dayIndex, totalDays).reduce((penalty, { day, marker }) => {
        const plannedWork = worker.preferredWorkDays
          ? worker.preferredWorkDays.has(day)
          : ((day + worker.scheduleOffset) * worker.targetWorkDays) % totalDays < worker.targetWorkDays;
        return penalty + Number(marker === '明' ? !plannedWork : plannedWork);
      }, 0);
    }

    let impossible = false;
    const eligibleWorkers = preparedWorkers.map((worker) => {
      const name = worker.name;
      const workCount = state.workCounts[name];
      const markersRemaining = [...state.dayMarkers[name].entries()]
        .filter(([markerDay]) => markerDay >= dayIndex);
      const brightMarkersRemaining = markersRemaining.filter(([, marker]) => marker === '明').length;
      const maximumRemainingWorkDays = getMaximumFutureWorkDays(
        state.dayMarkers[name],
        dayIndex,
        totalDays,
        state.consecutive[name]
      );
      const markerToday = state.dayMarkers[name].get(dayIndex);
      const mustWorkToday = !markerToday && worker.targetWorkDays !== null
        && workCount + maximumRemainingWorkDays === worker.targetWorkDays;

      if (worker.targetWorkDays !== null
        && (workCount + brightMarkersRemaining > worker.targetWorkDays
          || workCount + maximumRemainingWorkDays < worker.targetWorkDays)) {
        impossible = true;
        return null;
      }

      if (worker.targetWorkDays !== null && workCount >= worker.targetWorkDays) {
        return null;
      }

      if (markerToday) {
        if (markerToday === '明' && state.consecutive[name] >= MAX_CONSECUTIVE_DAYS) impossible = true;
        return null;
      }

      if (state.consecutive[name] >= MAX_CONSECUTIVE_DAYS) {
        impossible ||= mustWorkToday;
        return null;
      }

      const previousPattern = state.previousPatterns[name];
      const availablePatterns = worker.patterns.filter((pattern) => {
        if (!isPatternTransitionAllowed(previousPattern, pattern.name)) return false;
        if (!canAssignNightPattern(pattern.name, state.consecutiveNightDuties[name])) return false;
        const futureMarkers = getPatternDayMarkers(pattern, dayIndex, totalDays);
        if (futureMarkers.some(({ day, marker }) => markersConflict(state.dayMarkers[name].get(day), marker))) return false;
        if (futureMarkers.some(({ marker }) => marker === '明') && state.consecutive[name] >= MAX_CONSECUTIVE_DAYS - 1) return false;
        return true;
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
        preferWork: worker.targetWorkDays !== null && (worker.preferredWorkDays
          ? worker.preferredWorkDays.has(dayIndex)
          : ((dayIndex + worker.scheduleOffset) * worker.targetWorkDays) % totalDays < worker.targetWorkDays)
      };
    }).filter(Boolean);

    if (impossible) {
      failedStates[dayIndex].add(stateKey);
      return false;
    }

    eligibleWorkers.sort((a, b) =>
      Number(b.mustWorkToday) - Number(a.mustWorkToday)
      || Number(b.preferWork) - Number(a.preferWork)
      || b.maxScore - a.maxScore
    );

    function advanceWorkerState(nextState, chosen) {
      const chosenMap = new Map(chosen.map((item) => [item.name, item.pattern]));
      for (const worker of preparedWorkers) {
        const name = worker.name;
        const chosenPattern = chosenMap.get(name);
        const markerToday = state.dayMarkers[name].get(dayIndex);
        if (chosenPattern) {
          nextState.consecutive[name] = state.consecutive[name] + 1;
          nextState.workCounts[name] = state.workCounts[name] + 1;
          nextState.previousPatterns[name] = chosenPattern.name;
          nextState.consecutiveNightDuties[name] = NIGHT_PATTERN_NAMES.has(chosenPattern.name)
            ? state.consecutiveNightDuties[name] + 1
            : 0;
          if (MRL_PATTERN_NAMES.has(chosenPattern.name)) nextState.shiftCounts[name].mrL += 1;
          if (chosenPattern.name === '①') nextState.shiftCounts[name].ichi += 1;
          for (const { day, marker } of getPatternDayMarkers(chosenPattern, dayIndex, totalDays)) {
            setDayMarker(nextState.dayMarkers[name], day, marker);
          }
        } else if (markerToday === '明') {
          nextState.consecutive[name] = state.consecutive[name] + 1;
          nextState.workCounts[name] = state.workCounts[name] + 1;
          nextState.previousPatterns[name] = null;
        } else {
          nextState.consecutive[name] = 0;
          nextState.previousPatterns[name] = null;
          if (markerToday !== '公夜後') nextState.consecutiveNightDuties[name] = 0;
        }
      }
    }

    function targetsRemainPossible(nextState) {
      const daysAfterToday = totalDays - dayIndex - 1;
      return preparedWorkers.every((worker) => {
        const name = worker.name;
        const count = nextState.workCounts[name];
        const futureMarkers = [...nextState.dayMarkers[name].entries()]
          .filter(([markerDay]) => markerDay > dayIndex);
        const futureBrightDays = futureMarkers.filter(([, marker]) => marker === '明').length;
        const maxAssignableDays = worker.targetWorkDays === null
          ? daysAfterToday - futureMarkers.length
          : worker.targetWorkDays - count - futureBrightDays;
        const countTargetPossible = worker.targetWorkDays === null || (
          count + futureBrightDays <= worker.targetWorkDays
          && count + getMaximumFutureWorkDays(
            nextState.dayMarkers[name],
            dayIndex + 1,
            totalDays,
            nextState.consecutive[name]
          ) >= worker.targetWorkDays
        );
        const shiftCountDifference = Math.abs(
          nextState.shiftCounts[name].mrL - nextState.shiftCounts[name].ichi
        );
        if (!countTargetPossible || shiftCountDifference > maxAssignableDays) return false;

        const balance = nextState.shiftCounts[name].mrL - nextState.shiftCounts[name].ichi;
        const openFutureDays = Array.from({ length: daysAfterToday }, (_, offset) => dayIndex + 1 + offset)
          .filter((futureDay) => !nextState.dayMarkers[name].has(futureDay));
        const futureWorkBudget = worker.targetWorkDays === null
          ? daysAfterToday
          : worker.targetWorkDays - count - futureBrightDays;

        if (balance > 0) {
          const canUseIchi = worker.patterns.some((pattern) => pattern.name === '①');
          if (!canUseIchi) return false;
          const lastDayIsOpen = openFutureDays.includes(totalDays - 1);
          const minimumWorkDaysForIchi = balance * 2 - Number(lastDayIsOpen);
          const maximumIchiAssignments = Math.ceil(daysAfterToday / 3);
          if (minimumWorkDaysForIchi > futureWorkBudget || balance > maximumIchiAssignments) return false;
        }

        if (balance < 0) {
          const canUseMrL = worker.patterns.some((pattern) => MRL_PATTERN_NAMES.has(pattern.name));
          if (!canUseMrL) return false;
          const requiredMrL = -balance;
          const maximumMrLAssignments = openFutureDays.length;
          if (requiredMrL > futureWorkBudget || requiredMrL > maximumMrLAssignments) return false;
        }

        return true;
      });
    }

    const usesMonthlyDaysOff = preparedWorkers.every((worker) => worker.targetWorkDays !== null);
    if (usesMonthlyDaysOff) {
      const candidates = [];

      function workDistributionPenalty(chosenWorkers) {
        const chosenNames = new Set(chosenWorkers.map((worker) => worker.name));
        const distribution = preparedWorkers.reduce((score, worker) => {
          const markerToday = state.dayMarkers[worker.name].get(dayIndex);
          const worksToday = markerToday === '明' || chosenNames.has(worker.name);
          const projectedCount = state.workCounts[worker.name] + Number(worksToday);
          const idealCount = worker.targetWorkDays * (dayIndex + 1) / totalDays;
          const ahead = Math.max(0, projectedCount - Math.ceil(idealCount));
          return {
            totalDeviation: score.totalDeviation + Math.abs(projectedCount - idealCount),
            maximumDeviation: Math.max(score.maximumDeviation, Math.abs(projectedCount - idealCount)),
            maximumAhead: Math.max(score.maximumAhead, ahead),
            aheadPenalty: score.aheadPenalty + ahead * ahead
          };
        }, { totalDeviation: 0, maximumDeviation: 0, maximumAhead: 0, aheadPenalty: 0 });
        const projectedTotal = preparedWorkers.reduce((total, worker) => {
          const markerToday = state.dayMarkers[worker.name].get(dayIndex);
          return total + state.workCounts[worker.name]
            + Number(markerToday === '明' || chosenNames.has(worker.name));
        }, 0);
        const totalTarget = preparedWorkers.reduce((total, worker) => total + worker.targetWorkDays, 0);
        const idealTotal = totalTarget * (dayIndex + 1) / totalDays;
        return {
          ...distribution,
          totalAhead: Math.max(0, projectedTotal - Math.ceil(idealTotal)),
          totalProgressDeviation: Math.abs(projectedTotal - idealTotal)
        };
      }

      function collectCandidates(workerIndex, chosenWorkers, penalty) {
        if (workerIndex >= eligibleWorkers.length) {
          const distribution = workDistributionPenalty(chosenWorkers);
          candidates.push({
            workers: [...chosenWorkers],
            penalty,
            ...distribution
          });
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
      candidates.sort((a, b) =>
        a.maximumDeviation - b.maximumDeviation
        || a.maximumAhead - b.maximumAhead
        || a.totalAhead - b.totalAhead
        || a.totalProgressDeviation - b.totalProgressDeviation
        || a.aheadPenalty - b.aheadPenalty
        || a.totalDeviation - b.totalDeviation
        || a.penalty - b.penalty
        || a.workers.length - b.workers.length
      );

      function assignPatterns(workersForDay) {
        const dailyCoverage = Array(requirements.length).fill(0);
        const chosen = [];
        const results = [];
        const resultLimit = 1;

        function choosePattern(remainingWorkers) {
          if (isOutOfBudget()) {
            return true;
          }
          if (remainingWorkers.length === 0) {
            const temporaryAbsences = resolveDailyAbsences(chosen);
            if (temporaryAbsences) {
              results.push({ chosen: [...chosen], temporaryAbsences });
            }
            return results.length >= resultLimit;
          }
          if (!canStillMeetRequirements(
            requirements,
            dailyCoverage,
            remainingWorkers.map((worker) => ({
              hours: [...new Set(worker.availablePatterns.flatMap((pattern) => pattern.hours))]
            }))
          )) {
            return false;
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

          const marginalCoverage = (pattern) => pattern.hours.reduce(
            (score, hour) => score + Number(dailyCoverage[hour] < requirements[hour]),
            0
          );
          const incrementalExcess = (pattern) => pattern.hours.length - marginalCoverage(pattern);
          candidatePairs.sort((a, b) => {
            const futureOffScore = ({ worker, pattern }) => {
              if (!isOvernight(pattern)) return 0;
              const overnightNeeded = requirements.some((required, hour) =>
                (hour < 7 * QUARTERS_PER_HOUR || hour >= 20 * QUARTERS_PER_HOUR)
                  && dailyCoverage[hour] < required
              );
              if (!overnightNeeded) return -1;
              if (!pattern.nextDayOff) return 2;
              const futureDay = dayIndex + 1;
              if (futureDay >= totalDays) return 1;
              const plannedWork = ((futureDay + worker.scheduleOffset) * worker.targetWorkDays) % totalDays
                < worker.targetWorkDays;
              return plannedWork ? 0 : 2;
            };
            return patternMarkerPenalty(a.worker, a.pattern) - patternMarkerPenalty(b.worker, b.pattern)
              || shiftBalancePenalty(a.worker.name, a.pattern.name) - shiftBalancePenalty(b.worker.name, b.pattern.name)
              || futureOffScore(b) - futureOffScore(a)
              || incrementalExcess(a.pattern) - incrementalExcess(b.pattern)
              || marginalCoverage(b.pattern) - marginalCoverage(a.pattern)
              || a.pattern.hours.length - b.pattern.hours.length
              || a.worker.availablePatterns.length - b.worker.availablePatterns.length;
          });
          for (const { worker, pattern } of candidatePairs) {
            for (const hour of pattern.hours) dailyCoverage[hour] += 1;
            chosen.push({ name: worker.name, pattern });
            const limitReached = choosePattern(remainingWorkers.filter((item) => item !== worker));
            chosen.pop();
            for (const hour of pattern.hours) dailyCoverage[hour] -= 1;
            if (limitReached) return true;
          }
          return false;
        }

        choosePattern(workersForDay);
        return results;
      }

      for (const candidate of candidates) {
        if (isOutOfBudget()) return false;
        const patternResults = assignPatterns(candidate.workers);
        for (const { chosen, temporaryAbsences } of patternResults) {

          const nextState = cloneState(state, preparedWorkers);
          advanceWorkerState(nextState, chosen);
          if (!targetsRemainPossible(nextState)) continue;

          assignments[dayIndex] = chosen.map((item) => ({
            name: item.name,
            patternName: item.pattern.name
          }));
          absenceAssignments[dayIndex] = temporaryAbsences;
          dayStatuses[dayIndex] = preparedWorkers.flatMap((worker) => {
            const marker = state.dayMarkers[worker.name].get(dayIndex);
            return marker ? [{ name: worker.name, status: marker === '明' ? '明' : '公' }] : [];
          });
          if (assignDay(dayIndex + 1, nextState)) return true;
          assignments[dayIndex] = [];
          absenceAssignments[dayIndex] = [];
          dayStatuses[dayIndex] = [];
        }
      }

      if (!timedOut) failedStates[dayIndex].add(stateKey);
      return false;
    }

    const coverage = Array(requirements.length).fill(0);

    function canStillMeetWithRemainingWorkers(startIndex) {
      for (let hour = 0; hour < requirements.length; hour += 1) {
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
        const temporaryAbsences = resolveDailyAbsences(chosen);
        if (!temporaryAbsences) return false;
        const nextState = cloneState(state, preparedWorkers);
        advanceWorkerState(nextState, chosen);
        if (!targetsRemainPossible(nextState)) {
          return false;
        }

        assignments[dayIndex] = chosen.map((item) => ({
          name: item.name,
          patternName: item.pattern.name
        }));
        absenceAssignments[dayIndex] = temporaryAbsences;
        dayStatuses[dayIndex] = preparedWorkers.flatMap((worker) => {
          const marker = state.dayMarkers[worker.name].get(dayIndex);
          return marker ? [{ name: worker.name, status: marker === '明' ? '明' : '公' }] : [];
        });
        if (assignDay(dayIndex + 1, nextState)) {
          return true;
        }
        assignments[dayIndex] = [];
        absenceAssignments[dayIndex] = [];
        dayStatuses[dayIndex] = [];
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
      const sortedPatterns = [...worker.availablePatterns].sort((a, b) => {
        const marginalCoverage = (pattern) => pattern.hours.reduce(
          (score, hour) => score + Number(coverage[hour] < requirements[hour]),
          0
        );
        const incrementalExcess = (pattern) => pattern.hours.length - marginalCoverage(pattern);
        return patternMarkerPenalty(worker, a) - patternMarkerPenalty(worker, b)
          || shiftBalancePenalty(worker.name, a.name) - shiftBalancePenalty(worker.name, b.name)
          || incrementalExcess(a) - incrementalExcess(b)
          || marginalCoverage(b) - marginalCoverage(a)
          || a.hours.length - b.hours.length;
      });

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

    const result = tryChoose(0, []);
    if (!result && !timedOut) failedStates[dayIndex].add(stateKey);
    return result;
  }

  const success = assignDay(0, initialState);
  if (!success) {
    if (timedOut) {
      return {
        success: false,
        error: '計算に時間がかかりすぎたため処理を中断しました。条件を見直すか、勤務者数や期間を減らしてください。',
        diagnostics: { furthestDay, workers: furthestSnapshot }
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
      shifts: names,
      temporaryAbsences: absenceAssignments[index],
      statuses: dayStatuses[index]
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
    buildQuarterRange,
    fillHourlyRequirements,
    canAssignNightPattern,
    getPatternDayMarkers,
    hasBalancedShiftCounts,
    isPatternTransitionAllowed,
    generateSchedule
  };
}

if (typeof self !== 'undefined') {
  self.AutoShiftScheduler = {
    buildHourRange,
    buildQuarterRange,
    fillHourlyRequirements,
    canAssignNightPattern,
    getPatternDayMarkers,
    hasBalancedShiftCounts,
    isPatternTransitionAllowed,
    generateSchedule
  };
}
