const assert = require('node:assert/strict');
const test = require('node:test');

const { buildScheduleTable, calculateWorkDays, toCsv, toTsv } = require('../exporter');

test('シフト結果を担当者と日付の表へ変換する', () => {
  const table = buildScheduleTable({
    assignments: [
      {
        date: '2026-08-01',
        shifts: [
          { name: '1さん', patternName: 'D' },
          { name: '3さん', patternName: '1' }
        ],
        statuses: []
      },
      {
        date: '2026-08-02',
        shifts: [],
        statuses: [
          { name: '3さん', status: '明' },
          { name: '2さん', status: '公' }
        ]
      }
    ]
  }, ['1さん', '2さん', '3さん']);

  assert.deepEqual(table, [
    ['勤務者', '2026-08-01', '2026-08-02', '勤務日数'],
    ['1さん', 'D', '公休', 1],
    ['2さん', '公休', '公', 0],
    ['3さん', '1', '明', 2]
  ]);
});

test('担当者ごとの勤務日数を集計する', () => {
  const counts = calculateWorkDays({
    assignments: [
      { shifts: [{ name: '田中', patternName: 'D' }] },
      { shifts: [{ name: '田中', patternName: 'R' }, { name: '佐藤', patternName: 'P' }] },
      { shifts: [], statuses: [{ name: '佐藤', status: '明' }] }
    ]
  }, ['田中', '佐藤']);

  assert.deepEqual([...counts], [['田中', 2], ['佐藤', 2]]);
});

test('CSVでカンマ、引用符、改行をエスケープする', () => {
  const csv = toCsv([
    ['日付', '姓,名'],
    ['2026-08-01', 'A"B\nC']
  ]);

  assert.equal(csv, '日付,"姓,名"\r\n2026-08-01,"A""B\nC"');
});

test('Googleスプレッドシート貼り付け用のTSVを生成する', () => {
  const tsv = toTsv([
    ['日付', '1さん'],
    ['2026-08-01', 'D']
  ]);

  assert.equal(tsv, '日付\t1さん\r\n2026-08-01\tD');
});
