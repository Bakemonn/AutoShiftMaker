importScripts('./scheduler.js', './milp-scheduler.js', './vendor/highs/highs.js');

let highsPromise = null;

async function getHighs() {
  if (!highsPromise) {
    highsPromise = Module({
      locateFile: (filename) => new URL(`./vendor/highs/${filename}`, self.location.href).href
    });
  }
  return highsPromise;
}

self.addEventListener('message', async (event) => {
  if (event.data?.type !== 'generate') return;
  try {
    self.postMessage({ type: 'progress', message: '最小のヘルプ時間を計算しています…' });
    const highs = await getHighs();
    const built = self.AutoShiftMilpScheduler.buildMilpModel({
      ...event.data.input,
      objectiveMode: 'schedule'
    });
    const solution = highs.solve(built.lp, {
      output_flag: false,
      presolve: 'on',
      time_limit: 30,
      mip_rel_gap: 0,
      mip_abs_gap: 0.5
    });
    const result = self.AutoShiftMilpScheduler.parseMilpResult(solution, built.metadata);
    if (!result.success) {
      self.postMessage({ type: 'result', result });
      return;
    }

    self.postMessage({ type: 'progress', message: '同じ条件の別パターンを作成しています…' });
    const alternatives = self.AutoShiftMilpScheduler.buildAlternativeSchedules(
      result,
      event.data.input,
      3
    );
    self.postMessage({
      type: 'result',
      result: {
        success: true,
        alternatives,
        helpQuarterTotal: result.helpQuarterTotal
      }
    });
  } catch (error) {
    self.postMessage({
      type: 'result',
      result: { success: false, error: error?.message || 'シフト計算中にエラーが発生しました。' }
    });
  }
});
