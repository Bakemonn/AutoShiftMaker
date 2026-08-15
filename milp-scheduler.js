(function (root, factory) {
  const value = factory(
    typeof module !== 'undefined' ? require('./scheduler') : root.AutoShiftScheduler
  );
  if (typeof module !== 'undefined') module.exports = value;
  if (root) root.AutoShiftMilpScheduler = value;
})(typeof self !== 'undefined' ? self : null, function (scheduler) {
  const NIGHT_NAMES = new Set(['①', '夜', '③']);
  const MRL_NAMES = new Set(['M', 'R', 'L']);
  const FORBIDDEN_TRANSITIONS = [
    ['E', 'D'], ['M', 'D'], ['E', 'A'], ['E', 'R'], ['M', 'A'], ['E', 'L']
  ];

  function daysInMonth(month) {
    const [year, monthNumber] = month.split('-').map(Number);
    return new Date(year, monthNumber, 0).getDate();
  }

  function normalizePatternIds(worker) {
    if (Array.isArray(worker.patternIds)) return worker.patternIds;
    return worker.patternId ? [worker.patternId] : [];
  }

  function variableName(workerIndex, dayIndex, patternIndex) {
    return `x_${workerIndex}_${dayIndex}_${patternIndex}`;
  }

  function formatExpression(terms) {
    const combined = new Map();
    for (const [name, coefficient] of terms) {
      combined.set(name, (combined.get(name) || 0) + coefficient);
    }
    const values = [...combined].filter(([, coefficient]) => coefficient !== 0);
    if (values.length === 0) return '0';
    return values.map(([name, coefficient], index) => {
      const sign = coefficient < 0 ? '-' : (index === 0 ? '' : '+');
      const absolute = Math.abs(coefficient);
      return `${sign}${absolute === 1 ? '' : `${absolute} `}${name}`;
    }).join(' ');
  }

  function buildMilpModel(input) {
    const {
      month,
      workers,
      patterns,
      hourlyRequirements,
      absenceRules = [],
      excludedSolutions = [],
      requiredHelpTotal = null,
      objectiveMode = 'schedule'
    } = input || {};
    if (!/^\d{4}-\d{2}$/.test(month || '')) throw new Error('対象月はYYYY-MM形式で指定してください。');
    if (!Array.isArray(workers) || workers.length === 0) throw new Error('勤務者を1人以上登録してください。');
    if (!Array.isArray(patterns) || patterns.length === 0) throw new Error('勤務体系を1つ以上登録してください。');

    const totalDays = daysInMonth(month);
    const requirements = Array.from({ length: 96 }, (_, quarter) => {
      const value = Number((hourlyRequirements || [])[Math.floor(quarter / 4)] || 0);
      if (!Number.isInteger(value) || value < 0) throw new Error('時間ごとの必要人数は0以上の整数で指定してください。');
      return value;
    });
    const preparedPatterns = patterns.map((pattern, patternIndex) => ({
      ...pattern,
      patternIndex,
      hours: scheduler.buildQuarterRange(pattern),
      hourSet: new Set(scheduler.buildQuarterRange(pattern))
    }));
    const patternById = new Map(preparedPatterns.map((pattern) => [pattern.id, pattern]));
    const preparedWorkers = workers.map((worker, workerIndex) => {
      const allowedPatterns = normalizePatternIds(worker).map((id) => patternById.get(id)).filter(Boolean);
      const requiredDaysOff = Number(worker.requiredDaysOff);
      if (!worker.name || allowedPatterns.length === 0) throw new Error('勤務者の入力内容が不正です。');
      if (!Number.isInteger(requiredDaysOff) || requiredDaysOff < 0 || requiredDaysOff > totalDays) {
        throw new Error('公休日数は対象月の日数以下の0以上の整数で指定してください。');
      }
      return {
        ...worker,
        workerIndex,
        allowedPatterns,
        targetWorkDays: totalDays - requiredDaysOff,
        requestedDaysOff: new Set(worker.requestedDaysOff || [])
      };
    });

    const binaries = [];
    const generals = [];
    const objectiveTerms = [];
    const constraints = [];
    const metadata = {
      month,
      totalDays,
      preparedPatterns,
      preparedWorkers,
      absenceVariables: [],
      helpVariables: [],
      assignmentVariables: []
    };
    const assignmentTieBreakDivisor = preparedWorkers.length * totalDays * 96 + 1;
    let constraintIndex = 0;
    const addConstraint = (terms, operator, rightHandSide) => {
      constraints.push(`c${constraintIndex += 1}: ${formatExpression(terms)} ${operator} ${rightHandSide}`);
    };
    const variablesFor = (worker, day, predicate = () => true) => worker.allowedPatterns
      .filter(predicate)
      .map((pattern) => [variableName(worker.workerIndex, day, pattern.patternIndex), pattern]);
    const assignmentTerms = (worker, day, predicate) => variablesFor(worker, day, predicate)
      .map(([name]) => [name, 1]);
    const brightTerms = (worker, day) => day === 0 ? [] : assignmentTerms(
      worker,
      day - 1,
      (pattern) => NIGHT_NAMES.has(pattern.name)
    );
    const publicTerms = (worker, day) => {
      const terms = [];
      if (day >= 2) {
        terms.push(...assignmentTerms(worker, day - 2, (pattern) => ['①', '夜'].includes(pattern.name)));
      }
      if (day >= 1) {
        terms.push(...assignmentTerms(worker, day - 1, (pattern) =>
          pattern.nextDayOff && !['①', '夜'].includes(pattern.name)
        ));
      }
      return terms;
    };

    for (const worker of preparedWorkers) {
      for (let day = 0; day < totalDays; day += 1) {
        for (const [name, pattern] of variablesFor(worker, day)) {
          binaries.push(name);
          metadata.assignmentVariables.push(name);
          if (objectiveMode !== 'helpOnly') {
            objectiveTerms.push([name, pattern.hours.length / assignmentTieBreakDivisor]);
          }
        }
        const occupiedTerms = [
          ...assignmentTerms(worker, day),
          ...brightTerms(worker, day),
          ...publicTerms(worker, day)
        ];
        addConstraint(occupiedTerms, '<=', 1);
        if (worker.requestedDaysOff.has(day + 1)) {
          addConstraint([...assignmentTerms(worker, day), ...brightTerms(worker, day)], '=', 0);
        }
      }

      const monthlyWorkTerms = [];
      for (let day = 0; day < totalDays; day += 1) {
        monthlyWorkTerms.push(...assignmentTerms(worker, day), ...brightTerms(worker, day));
      }
      addConstraint(monthlyWorkTerms, '=', worker.targetWorkDays);

      for (let start = 0; start <= totalDays - 5; start += 1) {
        const terms = [];
        for (let day = start; day < start + 5; day += 1) {
          terms.push(...assignmentTerms(worker, day), ...brightTerms(worker, day));
        }
        addConstraint(terms, '<=', 4);
      }

      const balanceTerms = [];
      for (let day = 0; day < totalDays; day += 1) {
        balanceTerms.push(...assignmentTerms(worker, day, (pattern) => MRL_NAMES.has(pattern.name)));
        balanceTerms.push(...assignmentTerms(worker, day, (pattern) => pattern.name === '①')
          .map(([name]) => [name, -1]));
      }
      addConstraint(balanceTerms, '=', 0);

      for (let day = 0; day < totalDays - 1; day += 1) {
        addConstraint([
          ...assignmentTerms(worker, day, (pattern) => MRL_NAMES.has(pattern.name)),
          ...assignmentTerms(worker, day + 1, (pattern) => MRL_NAMES.has(pattern.name))
        ], '<=', 1);
        for (const [previous, next] of FORBIDDEN_TRANSITIONS) {
          addConstraint([
            ...assignmentTerms(worker, day, (pattern) => pattern.name === previous),
            ...assignmentTerms(worker, day + 1, (pattern) => pattern.name === next)
          ], '<=', 1);
        }
      }

      for (let firstDay = 0; firstDay < totalDays; firstDay += 1) {
        for (const firstPattern of worker.allowedPatterns.filter((pattern) => NIGHT_NAMES.has(pattern.name))) {
          const secondDay = firstDay + (firstPattern.name === '③' ? 2 : 3);
          if (secondDay >= totalDays) continue;
          for (const secondPattern of worker.allowedPatterns.filter((pattern) => NIGHT_NAMES.has(pattern.name))) {
            const thirdDay = secondDay + (secondPattern.name === '③' ? 2 : 3);
            if (thirdDay >= totalDays) continue;
            for (const thirdPattern of worker.allowedPatterns.filter((pattern) => NIGHT_NAMES.has(pattern.name))) {
              addConstraint([
                [variableName(worker.workerIndex, firstDay, firstPattern.patternIndex), 1],
                [variableName(worker.workerIndex, secondDay, secondPattern.patternIndex), 1],
                [variableName(worker.workerIndex, thirdDay, thirdPattern.patternIndex), 1]
              ], '<=', 2);
            }
          }
        }
      }
    }

    const absenceByDay = new Map();
    for (const [ruleIndex, rule] of absenceRules.entries()) {
      const day = Number(String(rule.date || '').slice(-2)) - 1;
      if (day < 0 || day >= totalDays || !String(rule.date).startsWith(`${month}-`)) {
        throw new Error('勤務人数対象外の日付が不正です。');
      }
      const toQuarter = (time) => {
        const [hour, minute] = String(time).split(':').map(Number);
        return hour * 4 + minute / 15;
      };
      const start = toQuarter(rule.startTime);
      const end = toQuarter(rule.endTime);
      const hours = Array.from({ length: end - start }, (_, offset) => start + offset);
      const ruleTerms = [];
      for (const workerName of rule.workerNames || []) {
        const worker = preparedWorkers.find((item) => item.name === workerName);
        if (!worker) continue;
        const name = `z_${ruleIndex}_${worker.workerIndex}`;
        binaries.push(name);
        ruleTerms.push([name, 1]);
        const coveringPatterns = assignmentTerms(worker, day, (pattern) =>
          hours.every((hour) => pattern.hourSet.has(hour))
        );
        addConstraint([[name, 1], ...coveringPatterns.map(([variable]) => [variable, -1])], '<=', 0);
        metadata.absenceVariables.push({ name, rule, workerName, day, hours });
      }
      if (ruleTerms.length === 0) throw new Error('勤務人数対象外時間の担当者が不正です。');
      addConstraint(ruleTerms, '=', 1);
      const items = absenceByDay.get(day) || [];
      items.push(...metadata.absenceVariables.filter((item) => item.day === day && item.rule === rule));
      absenceByDay.set(day, items);
    }

    for (let day = 0; day < totalDays; day += 1) {
      for (let quarter = 0; quarter < 96; quarter += 1) {
        if (requirements[quarter] === 0) continue;
        const helpName = `h_${day}_${quarter}`;
        generals.push(helpName);
        metadata.helpVariables.push({ name: helpName, day, quarter });
        objectiveTerms.push([helpName, 1]);
        const terms = [];
        for (const worker of preparedWorkers) {
          terms.push(...assignmentTerms(worker, day, (pattern) => pattern.hourSet.has(quarter)));
        }
        for (const absence of absenceByDay.get(day) || []) {
          if (absence.hours.includes(quarter)) terms.push([absence.name, -1]);
        }
        terms.push([helpName, 1]);
        addConstraint(terms, '>=', requirements[quarter]);
      }
    }

    if (requiredHelpTotal !== null) {
      addConstraint(metadata.helpVariables.map((item) => [item.name, 1]), '=', requiredHelpTotal);
    }
    for (const selectedVariables of excludedSolutions) {
      const selected = selectedVariables.filter((name) => metadata.assignmentVariables.includes(name));
      if (selected.length > 0) addConstraint(selected.map((name) => [name, 1]), '<=', selected.length - 1);
    }

    const lp = [
      'Minimize',
      `obj: ${formatExpression(objectiveTerms)}`,
      'Subject To',
      ...constraints,
      'Binary',
      ...binaries,
      'Generals',
      ...generals,
      'End'
    ].join('\n');
    return { lp, metadata };
  }

  function parseMilpResult(solution, metadata) {
    if (solution.Status === 'Time limit reached' && !Number.isFinite(solution.ObjectiveValue)) {
      return { success: false, error: '制限時間内に実行可能なシフト案を発見できませんでした。' };
    }
    if (!['Optimal', 'Time limit reached', 'Target for objective reached'].includes(solution.Status)) {
      return {
        success: false,
        error: solution.Status === 'Infeasible'
          ? '条件をすべて満たすシフト表は作成できません。公休日数や必要人数を見直してください。'
          : `シフト計算を完了できませんでした（${solution.Status}）。`
      };
    }
    const selected = (name) => (solution.Columns[name]?.Primal || 0) > 0.5;
    const helpByDay = new Map();
    let helpTotal = 0;
    for (const item of metadata.helpVariables) {
      const count = Math.round(solution.Columns[item.name]?.Primal || 0);
      if (count <= 0) continue;
      helpTotal += count;
      const values = helpByDay.get(item.day) || [];
      values.push({ quarter: item.quarter, count });
      helpByDay.set(item.day, values);
    }
    const quarterToTime = (quarter) => {
      const hour = Math.floor(quarter / 4);
      const minute = (quarter % 4) * 15;
      return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    };
    const helpRequests = [];
    for (const [day, values] of helpByDay) {
      values.sort((a, b) => a.quarter - b.quarter);
      let current = null;
      for (const value of values) {
        if (current && current.endQuarter === value.quarter && current.count === value.count) {
          current.endQuarter += 1;
        } else {
          current = {
            day: day + 1,
            date: `${metadata.month}-${String(day + 1).padStart(2, '0')}`,
            startQuarter: value.quarter,
            endQuarter: value.quarter + 1,
            count: value.count
          };
          helpRequests.push(current);
        }
      }
    }
    for (const request of helpRequests) {
      request.startTime = quarterToTime(request.startQuarter);
      request.endTime = request.endQuarter === 96 ? '24:00' : quarterToTime(request.endQuarter);
      delete request.startQuarter;
      delete request.endQuarter;
    }
    const assignments = Array.from({ length: metadata.totalDays }, (_, day) => {
      const shifts = [];
      const statuses = [];
      for (const worker of metadata.preparedWorkers) {
        const pattern = worker.allowedPatterns.find((item) =>
          selected(variableName(worker.workerIndex, day, item.patternIndex))
        );
        if (pattern) {
          shifts.push({ name: worker.name, patternName: pattern.name });
          continue;
        }
        const previousPattern = day > 0 ? worker.allowedPatterns.find((item) =>
          NIGHT_NAMES.has(item.name) && selected(variableName(worker.workerIndex, day - 1, item.patternIndex))
        ) : null;
        if (previousPattern) {
          statuses.push({ name: worker.name, status: '明' });
          continue;
        }
        const forcedPublic = (day >= 2 && worker.allowedPatterns.some((item) =>
          ['①', '夜'].includes(item.name) && selected(variableName(worker.workerIndex, day - 2, item.patternIndex))
        )) || (day >= 1 && worker.allowedPatterns.some((item) =>
          item.nextDayOff && !['①', '夜'].includes(item.name)
            && selected(variableName(worker.workerIndex, day - 1, item.patternIndex))
        )) || worker.requestedDaysOff.has(day + 1);
        if (forcedPublic) statuses.push({ name: worker.name, status: '公' });
      }
      const temporaryAbsences = metadata.absenceVariables
        .filter((item) => item.day === day && selected(item.name))
        .map((item) => ({
          ruleId: item.rule.id,
          name: item.workerName,
          startTime: item.rule.startTime,
          endTime: item.rule.endTime
        }));
      return {
        day: day + 1,
        date: `${metadata.month}-${String(day + 1).padStart(2, '0')}`,
        workers: shifts.map((shift) => shift.name),
        shifts,
        statuses,
        temporaryAbsences
      };
    });
    return {
      success: true,
      month: metadata.month,
      assignments,
      helpRequests,
      helpQuarterTotal: helpTotal,
      selectedAssignmentVariables: metadata.assignmentVariables.filter(selected)
    };
  }

  function buildAlternativeSchedules(baseResult, input, limit = 3) {
    if (!baseResult.success) return [];
    const absenceRules = input.absenceRules || [];
    const groups = new Map();
    for (const worker of input.workers || []) {
      const absenceMembership = absenceRules.map((rule) =>
        (rule.workerNames || []).includes(worker.name) ? rule.id : ''
      );
      const signature = JSON.stringify({
        patterns: [...normalizePatternIds(worker)].sort(),
        requiredDaysOff: worker.requiredDaysOff,
        requestedDaysOff: [...(worker.requestedDaysOff || [])].sort((a, b) => a - b),
        absenceMembership
      });
      const names = groups.get(signature) || [];
      names.push(worker.name);
      groups.set(signature, names);
    }
    const swappable = [...groups.values()].sort((a, b) => b.length - a.length)[0] || [];
    const alternatives = [baseResult];
    for (let offset = 1; offset < Math.min(limit, swappable.length); offset += 1) {
      const replacements = new Map(swappable.map((name, index) => [
        name,
        swappable[(index + offset) % swappable.length]
      ]));
      const replaceName = (name) => replacements.get(name) || name;
      alternatives.push({
        ...baseResult,
        selectedAssignmentVariables: undefined,
        assignments: baseResult.assignments.map((assignment) => ({
          ...assignment,
          workers: assignment.workers.map(replaceName),
          shifts: assignment.shifts.map((shift) => ({ ...shift, name: replaceName(shift.name) })),
          statuses: assignment.statuses.map((status) => ({ ...status, name: replaceName(status.name) })),
          temporaryAbsences: assignment.temporaryAbsences.map((absence) => ({
            ...absence,
            name: replaceName(absence.name)
          }))
        }))
      });
    }
    return alternatives;
  }

  return { buildAlternativeSchedules, buildMilpModel, parseMilpResult };
});
