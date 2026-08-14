(function (root, factory) {
  const value = factory();
  if (typeof module !== 'undefined') {
    module.exports = value;
  }
  if (root) {
    root.AutoShiftTestPattern = value;
  }
})(typeof window !== 'undefined' ? window : null, function () {
  const patterns = [
    { id: 'D', name: 'D', maxPerWeek: 7, startHour: 7, endHour: 16 },
    { id: 'R', name: 'R', maxPerWeek: 7, startHour: 8, endHour: 19 },
    { id: 'M', name: 'M', maxPerWeek: 7, startHour: 9, endHour: 20 },
    { id: 'E', name: 'E', maxPerWeek: 7, startHour: 11, endHour: 20 },
    { id: '1', name: '1', maxPerWeek: 7, startHour: 17, endHour: 9 },
    { id: 'P', name: 'P', maxPerWeek: 7, startHour: 9, endHour: 16 },
    { id: 'P2', name: 'P2', maxPerWeek: 7, startHour: 8, endHour: 16 },
    { id: 'B', name: 'B', maxPerWeek: 7, startHour: 9, endHour: 18 },
    { id: 'short', name: '短', maxPerWeek: 7, startHour: 7, endHour: 14 },
  ];

  const exceptP = patterns.map((pattern) => pattern.id).filter((id) => id !== 'P');
  const workers = [
    { name: '1さん', patternIds: exceptP, requiredDaysOff: 9 },
    { name: '2さん', patternIds: ['B'], requiredDaysOff: 9 },
    { name: '3さん', patternIds: exceptP, requiredDaysOff: 9 },
    { name: '4さん', patternIds: ['short'], requiredDaysOff: 9 },
    { name: '5さん', patternIds: ['P2'], requiredDaysOff: 12 },
    { name: '6さん', patternIds: ['P'], requiredDaysOff: 12 },
    { name: '7さん', patternIds: exceptP, requiredDaysOff: 9 },
    { name: '8さん', patternIds: exceptP, requiredDaysOff: 9 },
    { name: '9さん', patternIds: exceptP, requiredDaysOff: 9 },
    { name: '10さん', patternIds: exceptP, requiredDaysOff: 9 },
  ];

  const hourlyRequirements = Array.from({ length: 24 }, (_, hour) => {
    if (hour >= 8 && hour < 16) return 3;
    if (hour === 7 || hour === 16) return 2;
    if (hour >= 17 && hour < 20) return 3;
    return 1;
  });

  return { patterns, workers, hourlyRequirements, maxConsecutiveDays: 31 };
});
