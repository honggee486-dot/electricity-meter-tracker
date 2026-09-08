// Entirely synthetic fixtures. These numbers are presentation examples, not domain results.
export const demo = {
  meter: { name: '우리집 전기', timezone: 'Asia/Seoul', closingDay: 21 },
  cycle: { label: '8/22 ~ 9/21', example: '8월 22일 ~ 9월 21일', usage: '322', remainingDays: '13' },
  interval: { usage: '5.0', elapsed: '6시간 30분', power: '769' },
  recentDailyAverage: '17.4',
  cycleDailyAverage: '17.1',
  forecastUsage: '548',
  normalized30DayUsage: '522',
  estimatedBill: '120,000',
  readings: [
    { at: '2026-09-08T18:30:00+09:00', value: '7132' },
    { at: '2026-09-08T12:00:00+09:00', value: '7127' },
    { at: '2026-09-07T20:15:00+09:00', value: '7118' },
  ],
  daily: [
    { date: '9/08', usage: '16.4', basis: 'interpolated' },
    { date: '9/07', usage: '18.1', basis: 'boundary' },
    { date: '9/06', usage: '15.9', basis: 'boundary' },
    { date: '9/05', usage: '17.3', basis: 'boundary' },
  ],
  viewer: '샘플 사용자',
} as const;
