import { demo } from './demo';
import './style.css';

type Screen = 'home' | 'records' | 'analysis' | 'settings';
const screens: { id: Screen; label: string; icon: string }[] = [
  { id: 'home', label: '홈', icon: '<path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/>' },
  { id: 'records', label: '기록', icon: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' },
  { id: 'analysis', label: '분석', icon: '<path d="M4 20V10m8 10V4m8 16v-7"/>' },
  { id: 'settings', label: '설정', icon: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>' },
];
const app = document.querySelector<HTMLDivElement>('#app')!;
const quantity = (value: string, unit: string) => `<span class="quantity">${value}<small>${unit}</small></span>`;
const metric = (label: string, value: string, unit: string) => `<div><dt>${label}</dt><dd>${quantity(value, unit)}</dd></div>`;
const formatTime = (at: string) => new Intl.DateTimeFormat('ko-KR', {
  timeZone: demo.meter.timezone, month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).format(new Date(at));

app.innerHTML = `
  <div class="shell">
    <header class="masthead"><a href="#home" class="brand" aria-label="우리집 전기 홈"><span class="brand-mark" aria-hidden="true">↗</span> 전기 기록</a><span class="demo-tag">SAMPLE / DEMO</span></header>
    <p class="demo-notice">가상 데이터로 둘러보는 UI · 새로고침하면 초기화됩니다.</p>
    <main id="main">
      <section id="home" class="screen" aria-labelledby="home-title">
        <div class="page-heading"><p class="eyebrow">가볍게 기록하는 에너지 일상</p><h1 id="home-title" tabindex="-1">${demo.meter.name}</h1><p class="cycle-label">현재 검침기간 <strong>${demo.cycle.label}</strong><span>샘플</span></p></div>
        <form id="reading-form" class="reading-form">
          <label for="meter-reading">현재 계량기</label>
          <div class="reading-input"><input id="meter-reading" name="reading" type="text" inputmode="decimal" pattern="[0-9]+([.][0-9]+)?" maxlength="15" autocomplete="off" spellcheck="false" placeholder="${demo.readings[0].value}" aria-describedby="reading-hint" required /><span>kWh</span></div>
          <p id="reading-hint">기록 시각은 자동 · 15자 이내 숫자와 소수점</p>
          <button id="record-button" class="primary" type="submit" disabled>기록하기 <span aria-hidden="true">↗</span></button>
          <p id="record-status" class="status" role="status" aria-live="polite"></p>
        </form>
        <section class="interval" aria-labelledby="interval-title"><div class="section-heading"><h2 id="interval-title">직전 기록 이후</h2><span class="subtle">고정 샘플</span></div><p class="hero-number">${quantity(demo.interval.usage, 'kWh')}</p><dl class="interval-details">${metric('경과시간', demo.interval.elapsed, '')}${metric('평균 소비전력', demo.interval.power, 'W')}</dl></section>
        <section class="cycle-summary" aria-labelledby="cycle-title"><div class="section-heading"><h2 id="cycle-title">이번 검침주기</h2><span class="deadline">마감까지 ${demo.cycle.remainingDays}일</span></div><dl class="summary-list">${metric('현재까지', demo.cycle.usage, 'kWh')}${metric('최근 일평균', demo.recentDailyAverage, 'kWh/일')}${metric('마감 예상 사용량', demo.forecastUsage, 'kWh')}${metric('예상 전기요금', `약 ${demo.estimatedBill}`, '원')}</dl><p class="note">모든 지표는 고정 예시이며 입력값으로 계산하지 않습니다. 예상 요금은 실제 한전 요금표를 적용하지 않은 샘플입니다.</p></section>
      </section>
      <section id="records" class="screen" aria-labelledby="records-title" hidden>
        <div class="page-heading"><p class="eyebrow">지나가며 남긴 숫자들</p><h1 id="records-title" tabindex="-1">기록</h1><p>누적 계량값 · ${demo.meter.timezone}</p></div>
        <p class="note">아래 기록은 모두 데모입니다. 체험 입력은 이 페이지를 여는 동안에만 남으며, 수정·삭제는 아직 지원하지 않습니다.</p>
        <ul id="reading-list" class="reading-list" aria-label="계량기 기록"></ul>
      </section>
      <section id="analysis" class="screen" aria-labelledby="analysis-title" hidden>
        <div class="page-heading"><p class="eyebrow">사용량을 읽는 여러 기준</p><h1 id="analysis-title" tabindex="-1">분석</h1><p>계산 결과가 아닌 고정 샘플입니다.</p></div>
        <dl class="analysis-list">
          <div><dt>최근 측정 구간 <small>${demo.interval.elapsed}</small></dt><dd>${quantity(demo.interval.usage, 'kWh')}<small>평균 소비전력 ${demo.interval.power} W</small></dd></div>
          ${metric('최근 일평균', demo.recentDailyAverage, 'kWh/일')}
          ${metric('현재 검침주기 평균', demo.cycleDailyAverage, 'kWh/일')}
          <div class="forecast"><dt>검침 마감 예상 <small>${demo.cycle.label}</small></dt><dd>${quantity(demo.forecastUsage, 'kWh')}</dd></div>
          <div class="normalized"><dt>30일 환산 <small>기간을 맞춰 비교하는 참고값</small></dt><dd>${quantity(demo.normalized30DayUsage, 'kWh')}</dd></div>
        </dl>
        <p class="note">예측 신뢰도 안내 예시: 기록 기간이 짧으면 신뢰도가 낮습니다. 실제 신뢰도 판단과 예측은 아직 구현하지 않았습니다.</p>
        <section class="daily" aria-labelledby="daily-title"><h2 id="daily-title">일별 사용량</h2><p class="note">경계 측정과 보간의 표시 방식 예시입니다.</p><ul class="daily-list">${demo.daily.map(day => `<li><span>${day.date}</span><span class="daily-bar" aria-hidden="true"><i style="width:${Number(day.usage) / 20 * 100}%"></i></span><strong>${day.basis === 'interpolated' ? '약 ' : ''}${day.usage}<small> kWh</small></strong><span class="basis">${day.basis === 'interpolated' ? '추정·보간' : '경계 측정'}</span></li>`).join('')}</ul></section>
      </section>
      <section id="settings" class="screen" aria-labelledby="settings-title" hidden>
        <div class="page-heading"><p class="eyebrow">내 계량기의 기준</p><h1 id="settings-title" tabindex="-1">설정</h1><p>읽기 전용 데모 · 변경은 아직 지원하지 않습니다.</p></div>
        <dl class="settings-list"><div><dt>계량기 이름</dt><dd>${demo.meter.name}</dd></div><div><dt>검침 마감일</dt><dd>매월 ${demo.meter.closingDay}일</dd></div><div><dt>시간대</dt><dd>${demo.meter.timezone}</dd></div></dl>
        <aside class="period-example"><h2>검침기간 예</h2><p>${demo.cycle.example}</p><p class="note">마감일 다음 날부터 다음 마감일까지 표시합니다. 29~31일이 없는 달의 처리 정책은 아직 미정입니다.</p></aside>
        <section class="sharing" aria-labelledby="sharing-title"><div class="section-heading"><h2 id="sharing-title">공유</h2><span class="subtle">UI 예시</span></div><p class="share-person"><span>${demo.viewer}<small>가상 인물</small></span><span>조회 가능 · viewer</span></p><button class="secondary" type="button" disabled>사용자 초대 · 준비 중</button><p class="note">소유자(owner)와 조회자(viewer)만을 기본 후보로 둡니다. 실제 초대 및 접근 권한은 연결되지 않았습니다.</p></section>
      </section>
    </main>
    <nav class="bottom-nav" aria-label="주 메뉴">${screens.map(screen => `<a href="#${screen.id}" data-screen="${screen.id}" ${screen.id === 'home' ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${screen.icon}</svg><span>${screen.label}</span></a>`).join('')}</nav>
  </div>`;

// Transient UI entries only: deliberately no repository, persistence, or calculation service.
const readings: { at: string; value: string; source: string }[] = demo.readings.map(reading => ({ ...reading, source: '샘플' }));
function renderReadings() {
  const list = document.querySelector<HTMLUListElement>('#reading-list')!;
  list.replaceChildren(...readings.map(reading => {
    const item = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = reading.at;
    time.textContent = formatTime(reading.at);
    const source = document.createElement('small');
    source.textContent = reading.source;
    const value = document.createElement('strong');
    value.textContent = reading.value;
    const unit = document.createElement('small');
    unit.textContent = ' kWh';
    value.append(unit);
    const label = document.createElement('span');
    label.append(time, source);
    item.append(label, value);
    return item;
  }));
}
renderReadings();

const input = document.querySelector<HTMLInputElement>('#meter-reading')!;
const button = document.querySelector<HTMLButtonElement>('#record-button')!;
const status = document.querySelector<HTMLParagraphElement>('#record-status')!;
// Input syntax only. Monotonic readings, precision, and time validation belong to the future usage domain.
const validInput = () => input.value.length <= 15 && /^[0-9]+(?:\.[0-9]+)?$/.test(input.value);
input.addEventListener('input', () => {
  input.classList.toggle('long-value', input.value.length > 9);
  button.disabled = !validInput();
  status.textContent = '';
});
document.querySelector<HTMLFormElement>('#reading-form')!.addEventListener('submit', event => {
  event.preventDefault();
  if (!validInput()) return;
  const value = input.value;
  readings.unshift({ at: new Date().toISOString(), value, source: '체험 입력 · 임시' });
  renderReadings();
  status.textContent = `${value} kWh 체험 기록 완료. 기록 탭에서 확인하세요. 지표는 고정 샘플입니다.`;
  input.value = '';
  input.classList.remove('long-value');
  button.disabled = true;
});

function navigate(moveFocus: boolean) {
  const target = location.hash.slice(1);
  const selected = screens.find(screen => screen.id === target) ?? screens[0];
  for (const screen of screens) document.getElementById(screen.id)!.hidden = screen.id !== selected.id;
  document.querySelectorAll<HTMLAnchorElement>('[data-screen]').forEach(link => {
    if (link.dataset.screen === selected.id) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (moveFocus) document.getElementById(`${selected.id}-title`)!.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => navigate(true));
navigate(false);
