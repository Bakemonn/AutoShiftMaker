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
    { id: 'D', name: 'D', startHour: 7, endHour: 16 },
    { id: 'R', name: 'R', startHour: 8, endHour: 19 },
    { id: 'M', name: 'M', startHour: 9, endHour: 20 },
    { id: 'E', name: 'E', startHour: 11, endHour: 20 },
    { id: 'P', name: 'P', startHour: 9, endHour: 16 },
    { id: 'P2', name: 'P2', startHour: 8, endHour: 16 },
    { id: 'B', name: 'B', startHour: 9, endHour: 18 },
    { id: 'short', name: '短', startHour: 7, endHour: 14 },
    { id: '3-circle', name: '③', startHour: 22, endHour: 7, nextDayOff: false },
    { id: '1-circle', name: '①', startHour: 17, startMinute: 30, endHour: 9, endMinute: 30, nextDayOff: true },
    {
      id: 'night',
      name: '夜',
      startHour: 17,
      startMinute: 15,
      endHour: 11,
      endMinute: 15,
      breaks: [{ startHour: 9, endHour: 10 }],
      nextDayOff: true
    },
    { id: 'A', name: 'A', startHour: 8, endHour: 17 },
    { id: 'C', name: 'C', startHour: 10, endHour: 19 },
    { id: 'E-half', name: 'E半', startHour: 11, endHour: 16 },
    { id: 'half-E', name: '半E', startHour: 16, endHour: 20 },
    { id: 'D-half', name: 'D半', startHour: 7, endHour: 11 },
    { id: 'half-D', name: '半D', startHour: 11, endHour: 16 },
    { id: 'A-short', name: 'A短', startHour: 8, endHour: 15 },
    { id: 'L', name: 'L', startHour: 7, endHour: 18 },
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

  return { patterns, workers, hourlyRequirements };
});
