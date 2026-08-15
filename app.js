(function () {
  const STORAGE_KEY = 'autoshiftmaker.patterns';

  const monthInput = document.getElementById('month');
  const addPatternButton = document.getElementById('addPattern');
  const addWorkerButton = document.getElementById('addWorker');
  const generateButton = document.getElementById('generate');
  const cancelGenerationButton = document.getElementById('cancelGeneration');
  const loadTestPatternButton = document.getElementById('loadTestPattern');

  const patternNameInput = document.getElementById('patternName');
  const patternStartHourInput = document.getElementById('patternStartHour');
  const patternEndHourInput = document.getElementById('patternEndHour');
  const patternNextDayOffInput = document.getElementById('patternNextDayOff');

  const workerNameInput = document.getElementById('workerName');
  const workerDaysOffInput = document.getElementById('workerDaysOff');
  const workerPatternOptions = document.getElementById('workerPatternOptions');
  const workerRequestedDaysOffOptions = document.getElementById('workerRequestedDaysOffOptions');
  const saveRequestedDaysOffButton = document.getElementById('saveRequestedDaysOff');
  const cancelRequestedDaysOffEditButton = document.getElementById('cancelRequestedDaysOffEdit');
  const absenceWorkerOptions = document.getElementById('absenceWorkerOptions');
  const absenceDateInput = document.getElementById('absenceDate');
  const absenceStartHourInput = document.getElementById('absenceStartHour');
  const absenceStartMinuteInput = document.getElementById('absenceStartMinute');
  const absenceEndHourInput = document.getElementById('absenceEndHour');
  const absenceEndMinuteInput = document.getElementById('absenceEndMinute');
  const saveAbsenceButton = document.getElementById('saveAbsence');
  const cancelAbsenceEditButton = document.getElementById('cancelAbsenceEdit');

  const patternList = document.getElementById('patternList');
  const workerList = document.getElementById('workerList');
  const absenceList = document.getElementById('absenceList');
  const output = document.getElementById('output');

  const hourlyInputs = Array.from({ length: 24 }, (_, hour) => document.getElementById(`hour-${hour}`));

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let patterns = loadPatterns();
  let workers = [];
  let absenceRules = [];
  let editingAbsenceId = null;
  let editingRequestedDaysOffWorkerIndex = null;
  let activeSolverWorker = null;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatTime(hour, minute = 0) {
    return `${String(hour).padStart(2, '0')}:${String(minute || 0).padStart(2, '0')}`;
  }

  function loadPatterns() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function savePatterns() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns));
  }

  function renderPatterns() {
    patternList.innerHTML = '';
    workerPatternOptions.innerHTML = '';
    workerPatternOptions.className = 'pattern-options';

    for (const pattern of patterns) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      const nextDayOffText = pattern.nextDayOff ? ' / 翌日公休' : '';
      const breakText = (pattern.breaks || []).length > 0
        ? ` / 休憩 ${pattern.breaks.map((rest) => `${formatTime(rest.startHour, rest.startMinute)}〜${formatTime(rest.endHour, rest.endMinute)}`).join('、')}`
        : '';
      text.textContent = `${pattern.name}: ${formatTime(pattern.startHour, pattern.startMinute)}〜${formatTime(pattern.endHour, pattern.endMinute)}${breakText}${nextDayOffText}`;
      li.appendChild(text);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', () => {
        patterns = patterns.filter((item) => item.id !== pattern.id);
        workers = workers
          .map((worker) => {
            const workerPatternIds = Array.isArray(worker.patternIds)
              ? worker.patternIds
              : (worker.patternId ? [worker.patternId] : []);
            return {
              name: worker.name,
              patternIds: workerPatternIds.filter((id) => id !== pattern.id),
              requiredDaysOff: worker.requiredDaysOff
            };
          })
          .filter((worker) => worker.patternIds.length > 0);
        const remainingWorkerNames = new Set(workers.map((worker) => worker.name));
        absenceRules = absenceRules
          .map((rule) => ({ ...rule, workerNames: rule.workerNames.filter((name) => remainingWorkerNames.has(name)) }))
          .filter((rule) => rule.workerNames.length > 0);
        savePatterns();
        renderPatterns();
        renderWorkers();
        output.innerHTML = '<p class="message success">勤務体系を削除しました。</p>';
      });
      li.appendChild(deleteButton);
      patternList.appendChild(li);

      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = pattern.id;
      checkbox.className = 'worker-pattern-checkbox';
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(pattern.name));
      workerPatternOptions.appendChild(label);
    }
  }

  function renderWorkers() {
    workerList.innerHTML = '';
    for (const [index, worker] of workers.entries()) {
      const li = document.createElement('li');
      const workerPatternIds = Array.isArray(worker.patternIds)
        ? worker.patternIds
        : (worker.patternId ? [worker.patternId] : []);
      const patternNames = workerPatternIds
        .map((id) => patterns.find((item) => item.id === id)?.name)
        .filter(Boolean);

      const text = document.createElement('span');
      const daysOffText = worker.requiredDaysOff === undefined ? '' : ` / 公休${worker.requiredDaysOff}日`;
      const requestedDaysOffText = (worker.requestedDaysOff || []).length > 0
        ? ` / 希望休${worker.requestedDaysOff.join('・')}日`
        : '';
      text.textContent = `${worker.name}（${patternNames.length > 0 ? patternNames.join(' / ') : '不明な勤務体系'}${daysOffText}${requestedDaysOffText}）`;
      li.appendChild(text);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'edit-button';
      editButton.textContent = '名前変更';
      editButton.addEventListener('click', () => {
        const nextName = window.prompt('新しい勤務者名を入力してください。', worker.name);
        if (nextName === null) return;

        const trimmedName = nextName.trim();
        if (!trimmedName) {
          output.innerHTML = '<p class="message error">勤務者名を入力してください。</p>';
          return;
        }
        if (workers.some((item, workerIndex) => workerIndex !== index && item.name === trimmedName)) {
          output.innerHTML = '<p class="message error">同じ名前の勤務者が登録されています。</p>';
          return;
        }

        absenceRules = absenceRules.map((rule) => ({
          ...rule,
          workerNames: rule.workerNames.map((name) => name === worker.name ? trimmedName : name)
        }));
        workers[index] = { ...worker, name: trimmedName };
        renderWorkers();
        output.innerHTML = '<p class="message success">勤務者名を変更しました。</p>';
      });
      li.appendChild(editButton);

      const requestedDaysOffButton = document.createElement('button');
      requestedDaysOffButton.type = 'button';
      requestedDaysOffButton.className = 'edit-button';
      requestedDaysOffButton.textContent = '希望休編集';
      requestedDaysOffButton.addEventListener('click', () => {
        editingRequestedDaysOffWorkerIndex = index;
        addWorkerButton.hidden = true;
        saveRequestedDaysOffButton.hidden = false;
        cancelRequestedDaysOffEditButton.hidden = false;
        renderRequestedDaysOffOptions(worker.requestedDaysOff || []);
      });
      li.appendChild(requestedDaysOffButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', () => {
        resetRequestedDaysOffEdit();
        workers = workers.filter((_, workerIndex) => workerIndex !== index);
        absenceRules = absenceRules
          .map((rule) => ({ ...rule, workerNames: rule.workerNames.filter((name) => name !== worker.name) }))
          .filter((rule) => rule.workerNames.length > 0);
        renderWorkers();
        output.innerHTML = '<p class="message success">勤務者を削除しました。</p>';
      });
      li.appendChild(deleteButton);
      workerList.appendChild(li);
    }
    const editingWorker = editingRequestedDaysOffWorkerIndex === null
      ? null
      : workers[editingRequestedDaysOffWorkerIndex];
    renderRequestedDaysOffOptions(editingWorker?.requestedDaysOff || []);
    renderAbsenceRules();
  }

  function getSelectedRequestedDaysOff() {
    return Array.from(document.querySelectorAll('.worker-requested-day-checkbox:checked'))
      .map((input) => Number(input.value));
  }

  function renderRequestedDaysOffOptions(selectedDays = []) {
    const [yearText, monthText] = monthInput.value.split('-');
    const year = Number(yearText);
    const monthIndex = Number(monthText) - 1;
    const totalDays = Number.isInteger(year) && monthIndex >= 0
      ? new Date(year, monthIndex + 1, 0).getDate()
      : 31;
    const selected = new Set(selectedDays);
    const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
    workerRequestedDaysOffOptions.innerHTML = '';
    for (let day = 1; day <= totalDays; day += 1) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = String(day);
      checkbox.className = 'worker-requested-day-checkbox';
      checkbox.checked = selected.has(day);
      label.appendChild(checkbox);
      const weekday = Number.isInteger(year) && monthIndex >= 0
        ? weekdays[new Date(year, monthIndex, day).getDay()]
        : '';
      label.appendChild(document.createTextNode(`${day}日(${weekday})`));
      workerRequestedDaysOffOptions.appendChild(label);
    }
  }

  function resetRequestedDaysOffEdit() {
    editingRequestedDaysOffWorkerIndex = null;
    addWorkerButton.hidden = false;
    saveRequestedDaysOffButton.hidden = true;
    cancelRequestedDaysOffEditButton.hidden = true;
    renderRequestedDaysOffOptions();
  }

  function resetAbsenceForm() {
    editingAbsenceId = null;
    absenceDateInput.value = '';
    absenceStartHourInput.value = '12';
    absenceStartMinuteInput.value = '00';
    absenceEndHourInput.value = '13';
    absenceEndMinuteInput.value = '00';
    saveAbsenceButton.textContent = '対象外時間を追加';
    cancelAbsenceEditButton.hidden = true;
    renderAbsenceRules();
  }

  function renderAbsenceRules() {
    const editingRule = absenceRules.find((rule) => rule.id === editingAbsenceId);
    absenceWorkerOptions.innerHTML = '';
    for (const worker of workers) {
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = worker.name;
      checkbox.className = 'absence-worker-checkbox';
      checkbox.checked = Boolean(editingRule?.workerNames.includes(worker.name));
      label.appendChild(checkbox);
      label.appendChild(document.createTextNode(worker.name));
      absenceWorkerOptions.appendChild(label);
    }

    absenceList.innerHTML = '';
    for (const rule of absenceRules) {
      const li = document.createElement('li');
      const text = document.createElement('span');
      text.textContent = `${rule.date} ${rule.startTime}〜${rule.endTime}（${rule.workerNames.join(' / ')}のうち1人 / 勤務人数対象外）`;
      li.appendChild(text);

      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'edit-button';
      editButton.textContent = '編集';
      editButton.addEventListener('click', () => {
        editingAbsenceId = rule.id;
        absenceDateInput.value = rule.date;
        [absenceStartHourInput.value, absenceStartMinuteInput.value] = rule.startTime.split(':');
        [absenceEndHourInput.value, absenceEndMinuteInput.value] = rule.endTime.split(':');
        saveAbsenceButton.textContent = '対象外時間を更新';
        cancelAbsenceEditButton.hidden = false;
        renderAbsenceRules();
      });
      li.appendChild(editButton);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', () => {
        absenceRules = absenceRules.filter((item) => item.id !== rule.id);
        resetAbsenceForm();
        output.innerHTML = '<p class="message success">対象外時間を削除しました。</p>';
      });
      li.appendChild(deleteButton);
      absenceList.appendChild(li);
    }
  }

  function renderSchedule(result) {
    if (!result.success) {
      output.innerHTML = `<div class="card"><p class="message error">${result.error}</p></div>`;
      return;
    }

    const patternSlots = new Map(patterns.map((pattern) => [
      pattern.name,
      new Set(window.AutoShiftScheduler.buildQuarterRange(pattern))
    ]));
    const worksInHour = (patternName, hour) => [...(patternSlots.get(patternName) || [])]
      .some((quarter) => Math.floor(quarter / 4) === hour);
    const activeHours = Array.from({ length: 24 }, (_, hour) => hour).filter((hour) =>
      result.assignments.some((assignment) => (assignment.shifts || []).some((shift) => {
        return worksInHour(shift.patternName, hour);
      }))
    );
    const hourlyHeaders = activeHours
      .map((hour) => `<th>${String(hour).padStart(2, '0')}:00</th>`)
      .join('');
    const hourlyRows = result.assignments.map((assignment) => {
      const cells = activeHours.map((hour) => {
        const names = (assignment.shifts || []).filter((shift) => {
          return worksInHour(shift.patternName, hour);
        }).map((shift) => {
          const temporaryAbsence = (assignment.temporaryAbsences || []).find((absence) => {
            if (absence.name !== shift.name) return false;
            const [startHour, startMinute] = absence.startTime.split(':').map(Number);
            const [endHour, endMinute] = absence.endTime.split(':').map(Number);
            const start = startHour * 60 + startMinute;
            const end = endHour * 60 + endMinute;
            return start < (hour + 1) * 60 && end > hour * 60;
          });
          if (temporaryAbsence) {
            return `<span class="worker-badge temporary-absence-badge">対象外: ${escapeHtml(shift.name)}（${temporaryAbsence.startTime}〜${temporaryAbsence.endTime}）</span>`;
          }
          return `<span class="worker-badge">${escapeHtml(shift.name)}</span>`;
        }).join('');
        return `<td class="worker-cell">${names}</td>`;
      }).join('');
      return `<tr><td>${escapeHtml(assignment.date)}</td>${cells}</tr>`;
    }).join('');

    const exportTable = window.AutoShiftExporter.buildScheduleTable(
      result,
      workers.map((worker) => worker.name)
    );
    const tableHeaders = exportTable[0]
      .map((value) => `<th>${escapeHtml(value)}</th>`)
      .join('');
    const tableRows = exportTable.slice(1).map((row) =>
      `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`
    ).join('');
    const helpRows = (result.helpRequests || []).map((request) => [
      `<td>${escapeHtml(request.date)}</td>`,
      `<td>${escapeHtml(request.startTime)}〜${escapeHtml(request.endTime)}</td>`,
      `<td>${request.count}人</td>`
    ].join('')).map((cells) => `<tr>${cells}</tr>`).join('');
    const helpMinutes = (result.helpQuarterTotal || 0) * 15;
    const helpDuration = `${Math.floor(helpMinutes / 60)}時間${helpMinutes % 60 ? `${helpMinutes % 60}分` : ''}`;
    const helpSection = helpRows
      ? [
        '<h3>必要なヘルプ</h3>',
        `<p class="message error">合計${helpDuration}（人数を加味した延べ時間）のヘルプが必要です。</p>`,
        '<div class="shift-table-wrapper">',
        '<table class="shift-table"><thead><tr><th>日付</th><th>時間</th><th>人数</th></tr></thead>',
        `<tbody>${helpRows}</tbody></table>`,
        '</div>'
      ].join('')
      : '<p class="message success">外部ヘルプなしで条件を満たします。</p>';

    output.innerHTML = [
      '<div class="card">',
      '<h2>シフト表</h2>',
      '<p class="message success">シフト表を作成しました。</p>',
      helpSection,
      '<div class="export-actions">',
      '<button id="exportCsv" type="button" class="btn btn-primary">CSVをダウンロード</button>',
      '<button id="exportGoogleSheets" type="button" class="btn btn-primary">Googleスプレッドシートへ出力</button>',
      '</div>',
      '<p id="exportMessage" class="hint"></p>',
      '<h3>時間帯ごとの勤務者</h3>',
      '<div class="shift-table-wrapper">',
      '<table class="shift-table hourly-shift-table">',
      `<thead><tr><th>日付</th>${hourlyHeaders}</tr></thead>`,
      `<tbody>${hourlyRows}</tbody>`,
      '</table>',
      '</div>',
      '<h3>CSV出力内容</h3>',
      '<div class="shift-table-wrapper">',
      '<table class="shift-table">',
      `<thead><tr>${tableHeaders}</tr></thead>`,
      `<tbody>${tableRows}</tbody>`,
      '</table>',
      '</div>',
      '</div>'
    ].join('');

    document.getElementById('exportCsv').addEventListener('click', () => {
      const csv = `\uFEFF${window.AutoShiftExporter.toCsv(exportTable)}`;
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `autoshift-${result.month}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      document.getElementById('exportMessage').textContent = 'CSVファイルをダウンロードしました。';
    });

    document.getElementById('exportGoogleSheets').addEventListener('click', async () => {
      const text = window.AutoShiftExporter.toTsv(exportTable);
      const sheetsWindow = window.open('https://sheets.new', '_blank', 'noopener');

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.style.position = 'fixed';
          textarea.style.opacity = '0';
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          if (!copied) throw new Error('コピーできませんでした。');
        }

        const message = sheetsWindow
          ? '新しいGoogleスプレッドシートのA1セルへ貼り付けてください。'
          : '表をコピーしました。Googleスプレッドシートを開き、A1セルへ貼り付けてください。';
        document.getElementById('exportMessage').textContent = message;
      } catch (_error) {
        document.getElementById('exportMessage').textContent = 'コピーできませんでした。CSVをダウンロードしてGoogleスプレッドシートへ読み込んでください。';
      }
    });
  }

  function renderScheduleAlternatives(result, selectedIndex = 0) {
    const alternatives = result.alternatives || [];
    if (alternatives.length === 0) {
      renderSchedule(result);
      return;
    }
    renderSchedule(alternatives[selectedIndex]);
    if (alternatives.length <= 1) return;
    const card = output.querySelector('.card');
    const controls = document.createElement('div');
    controls.className = 'export-actions';
    controls.innerHTML = alternatives.map((_, index) =>
      `<button type="button" class="btn ${index === selectedIndex ? 'btn-primary' : 'btn-add'}" data-alternative-index="${index}">パターン${index + 1}</button>`
    ).join('');
    card.insertBefore(controls, card.children[1]);
    controls.querySelectorAll('[data-alternative-index]').forEach((button) => {
      button.addEventListener('click', () => {
        renderScheduleAlternatives(result, Number(button.dataset.alternativeIndex));
      });
    });
  }

  addPatternButton.addEventListener('click', () => {
    const name = patternNameInput.value.trim();
    const startHour = Number(patternStartHourInput.value);
    const endHour = Number(patternEndHourInput.value);
    const nextDayOff = patternNextDayOffInput.checked;

    if (!name) {
      output.innerHTML = '<p class="message error">勤務体系名を入力してください。</p>';
      return;
    }

    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23 || !Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
      output.innerHTML = '<p class="message error">勤務時間は0〜23で入力してください。</p>';
      return;
    }

    const pattern = {
      id: `pattern-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      startHour,
      endHour,
      nextDayOff
    };

    patterns.push(pattern);
    savePatterns();
    renderPatterns();

    patternNameInput.value = '';
    patternNextDayOffInput.checked = false;
    output.innerHTML = '<p class="message success">勤務体系を登録しました。</p>';
  });

  addWorkerButton.addEventListener('click', () => {
    const name = workerNameInput.value.trim();
    const requiredDaysOff = Number(workerDaysOffInput.value);
    const patternIds = Array.from(document.querySelectorAll('.worker-pattern-checkbox:checked')).map((input) => input.value);
    const requestedDaysOff = getSelectedRequestedDaysOff();

    if (!name) {
      output.innerHTML = '<p class="message error">勤務者名を入力してください。</p>';
      return;
    }

    if (patternIds.length === 0) {
      output.innerHTML = '<p class="message error">勤務可能な勤務体系を1つ以上選択してください。</p>';
      return;
    }

    if (workers.some((worker) => worker.name === name)) {
      output.innerHTML = '<p class="message error">同じ名前の勤務者が登録されています。</p>';
      return;
    }

    if (!Number.isInteger(requiredDaysOff) || requiredDaysOff < 0 || requiredDaysOff > 31) {
      output.innerHTML = '<p class="message error">公休日数は0〜31の整数で入力してください。</p>';
      return;
    }

    if (requestedDaysOff.length > requiredDaysOff) {
      output.innerHTML = '<p class="message error">希望休は月間公休日数以下の日数で選択してください。</p>';
      return;
    }

    workers.push({ name, patternIds, requiredDaysOff, requestedDaysOff });
    renderWorkers();
    workerNameInput.value = '';
    document.querySelectorAll('.worker-pattern-checkbox:checked').forEach((input) => {
      input.checked = false;
    });
    output.innerHTML = '<p class="message success">勤務者を登録しました。</p>';
  });

  saveRequestedDaysOffButton.addEventListener('click', () => {
    const worker = workers[editingRequestedDaysOffWorkerIndex];
    if (!worker) {
      resetRequestedDaysOffEdit();
      return;
    }
    const requestedDaysOff = getSelectedRequestedDaysOff();
    if (requestedDaysOff.length > worker.requiredDaysOff) {
      output.innerHTML = '<p class="message error">希望休は月間公休日数以下の日数で選択してください。</p>';
      return;
    }
    workers[editingRequestedDaysOffWorkerIndex] = { ...worker, requestedDaysOff };
    resetRequestedDaysOffEdit();
    renderWorkers();
    output.innerHTML = '<p class="message success">希望休を更新しました。</p>';
  });

  cancelRequestedDaysOffEditButton.addEventListener('click', resetRequestedDaysOffEdit);

  saveAbsenceButton.addEventListener('click', () => {
    const workerNames = Array.from(document.querySelectorAll('.absence-worker-checkbox:checked'))
      .map((input) => input.value);
    const date = absenceDateInput.value;
    const startTime = `${absenceStartHourInput.value}:${absenceStartMinuteInput.value}`;
    const endTime = `${absenceEndHourInput.value}:${absenceEndMinuteInput.value}`;
    const toMinutes = (value) => {
      const [hour, minute] = value.split(':').map(Number);
      return hour * 60 + minute;
    };

    if (workerNames.length === 0) {
      output.innerHTML = '<p class="message error">担当者を1人以上選択してください。</p>';
      return;
    }
    if (!date || !date.startsWith(`${monthInput.value}-`)) {
      output.innerHTML = '<p class="message error">対象月内の抜ける日を入力してください。</p>';
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)
      || toMinutes(startTime) >= toMinutes(endTime)
      || toMinutes(startTime) % 15 !== 0 || toMinutes(endTime) % 15 !== 0) {
      output.innerHTML = '<p class="message error">抜ける時間は15分単位で、終了を開始より後にしてください。</p>';
      return;
    }

    const rule = {
      id: editingAbsenceId || `absence-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      workerNames,
      date,
      startTime,
      endTime
    };
    if (editingAbsenceId) {
      absenceRules = absenceRules.map((item) => item.id === editingAbsenceId ? rule : item);
    } else {
      absenceRules.push(rule);
    }
    const message = editingAbsenceId ? '対象外時間を更新しました。' : '対象外時間を追加しました。';
    resetAbsenceForm();
    output.innerHTML = `<p class="message success">${message}</p>`;
  });

  cancelAbsenceEditButton.addEventListener('click', resetAbsenceForm);

  loadTestPatternButton.addEventListener('click', () => {
    const testPattern = window.AutoShiftTestPattern;
    patterns = testPattern.patterns.map((pattern) => ({ ...pattern }));
    workers = testPattern.workers.map((worker) => ({
      ...worker,
      patternIds: [...worker.patternIds]
    }));
    absenceRules = [];
    editingAbsenceId = null;
    resetRequestedDaysOffEdit();
    hourlyInputs.forEach((input, hour) => {
      input.value = String(testPattern.hourlyRequirements[hour]);
    });
    savePatterns();
    renderPatterns();
    renderWorkers();
    output.innerHTML = '<p class="message success">指定のテストパターンを読み込みました。</p>';
  });

  generateButton.addEventListener('click', () => {
    const month = monthInput.value;
    const hourlyRequirements = window.AutoShiftScheduler.fillHourlyRequirements(
      hourlyInputs.map((input) => input.value)
    );

    generateButton.disabled = true;
    cancelGenerationButton.hidden = false;
    output.innerHTML = '<p class="message processing">最適化エンジンを準備しています…</p>';
    activeSolverWorker?.terminate();
    activeSolverWorker = new Worker('./solver-worker.js');
    activeSolverWorker.addEventListener('message', (event) => {
      if (event.data.type === 'progress') {
        output.innerHTML = `<p class="message processing">${escapeHtml(event.data.message)}</p>`;
        return;
      }
      if (event.data.type !== 'result') return;
      const result = event.data.result;
      activeSolverWorker?.terminate();
      activeSolverWorker = null;
      generateButton.disabled = false;
      cancelGenerationButton.hidden = true;
      if (result.success) renderScheduleAlternatives(result);
      else renderSchedule(result);
    });
    activeSolverWorker.addEventListener('error', (error) => {
      output.innerHTML = `<p class="message error">${escapeHtml(error.message || 'シフト計算を開始できませんでした。')}</p>`;
      activeSolverWorker?.terminate();
      activeSolverWorker = null;
      generateButton.disabled = false;
      cancelGenerationButton.hidden = true;
    });
    activeSolverWorker.postMessage({
      type: 'generate',
      input: { month, workers, patterns, hourlyRequirements, absenceRules }
    });
  });

  cancelGenerationButton.addEventListener('click', () => {
    activeSolverWorker?.terminate();
    activeSolverWorker = null;
    generateButton.disabled = false;
    cancelGenerationButton.hidden = true;
    output.innerHTML = '<p class="message">シフト計算をキャンセルしました。</p>';
  });

  monthInput.addEventListener('change', () => {
    const editingWorker = editingRequestedDaysOffWorkerIndex === null
      ? null
      : workers[editingRequestedDaysOffWorkerIndex];
    renderRequestedDaysOffOptions(editingWorker?.requestedDaysOff || []);
  });

  renderPatterns();
  renderWorkers();
})();
