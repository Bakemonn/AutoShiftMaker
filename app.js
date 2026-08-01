(function () {
  const STORAGE_KEY = 'autoshiftmaker.patterns';

  const monthInput = document.getElementById('month');
  const maxConsecutiveInput = document.getElementById('maxConsecutive');
  const addPatternButton = document.getElementById('addPattern');
  const addWorkerButton = document.getElementById('addWorker');
  const generateButton = document.getElementById('generate');

  const patternNameInput = document.getElementById('patternName');
  const patternMaxPerWeekInput = document.getElementById('patternMaxPerWeek');
  const patternStartHourInput = document.getElementById('patternStartHour');
  const patternEndHourInput = document.getElementById('patternEndHour');

  const workerNameInput = document.getElementById('workerName');
  const workerPatternOptions = document.getElementById('workerPatternOptions');

  const patternList = document.getElementById('patternList');
  const workerList = document.getElementById('workerList');
  const output = document.getElementById('output');

  const hourlyInputs = Array.from({ length: 24 }, (_, hour) => document.getElementById(`hour-${hour}`));

  const now = new Date();
  monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let patterns = loadPatterns();
  let workers = [];

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
      text.textContent = `${pattern.name}: 週${pattern.maxPerWeek}回 / ${String(pattern.startHour).padStart(2, '0')}:00〜${String(pattern.endHour).padStart(2, '0')}:00`;
      li.appendChild(text);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
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
              patternIds: workerPatternIds.filter((id) => id !== pattern.id)
            };
          })
          .filter((worker) => worker.patternIds.length > 0);
        savePatterns();
        renderPatterns();
        renderWorkers();
        output.innerHTML = '<p class="success">勤務体系を削除しました。</p>';
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
      text.textContent = `${worker.name}（${patternNames.length > 0 ? patternNames.join(' / ') : '不明な勤務体系'}）`;
      li.appendChild(text);

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.textContent = '削除';
      deleteButton.addEventListener('click', () => {
        workers = workers.filter((_, workerIndex) => workerIndex !== index);
        renderWorkers();
        output.innerHTML = '<p class="success">勤務者を削除しました。</p>';
      });
      li.appendChild(deleteButton);
      workerList.appendChild(li);
    }
  }

  function renderSchedule(result) {
    if (!result.success) {
      output.innerHTML = `<p class="error">${result.error}</p>`;
      return;
    }

    const rows = result.assignments.map((item) => {
      const workersText = item.shifts && item.shifts.length > 0
        ? item.shifts.map((shift) => `${shift.name}（${shift.patternName}）`).join('、')
        : '休み';
      return `<tr><td>${item.date}</td><td>${workersText}</td></tr>`;
    }).join('');

    output.innerHTML = [
      '<p class="success">シフト表を作成しました。</p>',
      '<table>',
      '<thead><tr><th>日付</th><th>勤務者</th></tr></thead>',
      `<tbody>${rows}</tbody>`,
      '</table>'
    ].join('');
  }

  addPatternButton.addEventListener('click', () => {
    const name = patternNameInput.value.trim();
    const maxPerWeek = Number(patternMaxPerWeekInput.value);
    const startHour = Number(patternStartHourInput.value);
    const endHour = Number(patternEndHourInput.value);

    if (!name) {
      output.innerHTML = '<p class="error">勤務体系名を入力してください。</p>';
      return;
    }

    if (!Number.isInteger(maxPerWeek) || maxPerWeek <= 0) {
      output.innerHTML = '<p class="error">週の勤務回数は1以上の整数で入力してください。</p>';
      return;
    }

    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23 || !Number.isInteger(endHour) || endHour < 0 || endHour > 23) {
      output.innerHTML = '<p class="error">勤務時間は0〜23で入力してください。</p>';
      return;
    }

    const pattern = {
      id: `pattern-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      name,
      maxPerWeek,
      startHour,
      endHour
    };

    patterns.push(pattern);
    savePatterns();
    renderPatterns();

    patternNameInput.value = '';
    output.innerHTML = '<p class="success">勤務体系を登録しました。</p>';
  });

  addWorkerButton.addEventListener('click', () => {
    const name = workerNameInput.value.trim();
    const patternIds = Array.from(document.querySelectorAll('.worker-pattern-checkbox:checked')).map((input) => input.value);

    if (!name) {
      output.innerHTML = '<p class="error">勤務者名を入力してください。</p>';
      return;
    }

    if (patternIds.length === 0) {
      output.innerHTML = '<p class="error">勤務可能な勤務体系を1つ以上選択してください。</p>';
      return;
    }

    workers.push({ name, patternIds });
    renderWorkers();
    workerNameInput.value = '';
    document.querySelectorAll('.worker-pattern-checkbox:checked').forEach((input) => {
      input.checked = false;
    });
    output.innerHTML = '<p class="success">勤務者を登録しました。</p>';
  });

  generateButton.addEventListener('click', () => {
    const month = monthInput.value;
    const maxConsecutiveDays = Number(maxConsecutiveInput.value);
    const hourlyRequirements = hourlyInputs.map((input) => Number(input.value || 0));

    const result = window.AutoShiftScheduler.generateSchedule({
      month,
      workers,
      patterns,
      hourlyRequirements,
      maxConsecutiveDays
    });

    renderSchedule(result);
  });

  renderPatterns();
  renderWorkers();
})();
