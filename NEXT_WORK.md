# NEXT_WORK.md

## 현재 완료: architecture / domain / Worker+D1 / Google session / authorized CRUD / live mobile UI baseline / canonical remote D1 provisioning / PWA installability shell / auth error boundary hardening / verified tariff policy v1 / tariff policy v2 (official components)

- [x] Vite + TypeScript + 기본 DOM/CSS, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로
- [x] 누적 kWh 문자열 → 정확한 정수 Wh, 절대 epoch-millisecond reading 계약
- [x] 구간 사용량·경과시간·평균 소비전력, 일자별 분할/보간과 `actual / interpolated` provenance
- [x] 검침 마감 `1~31일 + 월말`, 고정 날짜가 없는 달의 월말 자동 보정, 이전/현재/다음 검침주기와 경계 보간
- [x] 최근 구간/최근 완전 일자/주기 평균, 마감 예상, 30일 환산, 이전 주기 비교와 confidence evidence
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증
- [x] 동일-origin Worker API + D1 schema/migration/persistence + local workerd round trip
- [x] Google GIS ID token 검증, Google `sub` → 내부 user, 서명 HttpOnly session
- [x] 모든 meter/readings route의 server-side owner/viewer authorization
- [x] owner meter/readings CRUD, viewer read-only, exact instant 중복과 누적값 역행 방지
- [x] frontend same-origin API client가 auth/session, meters, readings만 알고 SQL/D1 세부를 알지 않음
- [x] UI가 인증 미설정 / signed-out / signed-in / loading / API error를 구분
- [x] Google GIS callback credential을 기존 CSRF-protected `/api/auth/google`에 전달하고 정상 session을 다시 확인하는 frontend flow
- [x] Google credential 검증 실패의 상세 진단은 server log에만 남기고 public API/UI에는 일반화된 오류만 노출
- [x] 첫 로그인 사용자의 첫 meter 생성, owner/viewer meter 선택, viewer read-only UI
- [x] owner 홈 빠른 입력이 현재 시각 + 누적 kWh를 POST하고 성공 후 raw readings를 다시 조회
- [x] 화면 usage/daily/billing/forecast가 `src/demo.ts` 고정 숫자가 아니라 실제 raw readings + meter 설정으로 계산
- [x] owner 설정에서 `1~31일 + 월말` 선택·저장, viewer 설정 read-only
- [x] tariff 미연결 상태에서는 가짜 요금을 표시하지 않고 명시적으로 미연결 상태를 표시
- [x] deterministic Playwright API/GIS mock으로 auth/owner/viewer/첫 meter/API 실패/빠른 입력/월말 설정/320px/keyboard 회귀 보호
- [x] `.dev.vars` / `.env` 계열 Secret 파일 Git 제외
- [x] build + persistence + local D1/workerd + Worker/auth/resource API + domain + Playwright GitHub Actions verify 경로 유지
- [x] canonical Cloudflare D1 생성, root `DB` binding 기록, `0001_initial.sql` remote migration 적용 및 상태 확인
- [x] 최종용 Google Web Client + Authorized JavaScript origin 등록, 명시적 TTL(14일) + public auth vars 설정, outside SESSION_SECRET 주입 및 dev alias version 배포
- [x] dev origin 실제 Google 로그인 → first user 자동 생성 → first meter 생성 → 실제 reading 저장 → reload 복원 E2E 검증 완료
- [x] live app metadata + Web App Manifest + 192/512/maskable/apple-touch first-party PNG로 PWA installability repository contract 구성
- [x] 공식 출처 provenance와 확인일을 갖는 주택용(저압) 2023-11-09 개정 전기요금 policy v1로 홈 예상 전기요금(기본요금·전력량요금 추정 소계) 표시
- [x] tariff policy v2: 기후환경요금·연료비조정요금(분기 window)·부가가치세(원단위 4사5입)·전력산업기반기금(10원 절사, 요율 window)·슈퍼유저요금(여름/겨울 1,000kWh 초과분 736.2원/kWh)·월간 최저요금 1,000원을 공식 근거와 provenance로 편입
- [x] 다음 제품 확장 방향을 같은 앱의 `전기 / 가스` utility switch로 확정하고, 가스 raw meter m³·데이터 migration·domain 분리·gas tariff provenance 계약을 `docs/GAS_METER_DIRECTION.md`에 고정

현재 UI는 실제 repository API/domain 계약을 사용하며, canonical Cloudflare remote D1 및 Google Web Client / Cloudflare auth runtime이 연결되어 dev preview(`https://dev-electricity-meter-tracker.247dev.workers.dev`)에서 실제 로그인과 데이터 복원이 검증되었습니다. Google credential 검증 실패는 public 응답과 UI에 verifier/provider detail을 노출하지 않고 server diagnostic에만 남깁니다. PWA는 설치 가능한 app shell 계약까지만 포함하며 service worker, offline cache, offline write queue, Background Sync는 아직 추가하지 않습니다. 전기요금은 주택용(저압) 2023-11-09 개정 policy(2026-09-09 공식 출처 확인) 기준 기본요금·전력량요금·기후환경요금·연료비조정요금(분기 고지 window)·부가가치세·전력산업기반기금·월간 최저요금을 더한 예상 합계(10원 미만 절사)를 표시하고, 복지할인과 TV수신료, 그리고 공식 고지가 없는 분기의 연료비조정요금을 미반영 항목으로 UI에 명시하며, policy가 커버하지 않는 마감 월과 계산 근거가 없는 경우 기존 미연결/자료 부족 표시를 유지합니다. repository 자동화 테스트에서는 deterministic mock과 local D1/workerd를 사용합니다. 다음 제품 확장은 전기 runtime을 보존하면서 `전기 / 가스`를 상위 utility switch로 추가하는 방향이며, 현재 schema/API의 `Wh/kWh` 전용 계약을 가스 값에 그대로 재사용하지 않습니다.

## 완료 WorkUnit: 모바일 UI와 auth/API/domain 연결 baseline

현재 계약:

1. `src/api.ts`가 frontend same-origin HTTP 경계를 소유하고 `/api/auth/*`, `/api/meters*`만 호출합니다. SQL/D1 binding은 frontend로 새지 않습니다.
2. `/api/auth/session`이 503이면 인증 환경 미설정, 401이면 Google 로그인 가능 상태, 정상 session이면 product UI로 진입합니다.
3. Google GIS script는 Client ID가 서버 `/api/auth/config`에서 실제 제공되는 signed-out 상태에서만 로드합니다. frontend callback은 host-only `g_csrf_token` cookie/body를 맞춰 기존 서버 double-submit 검증을 그대로 통과해야 합니다.
4. 로그인 사용자는 접근 가능한 owner/viewer meter만 선택합니다. owner는 기록·설정 mutation이 가능하고 viewer는 조회 전용입니다. 권한의 정본은 계속 서버/API입니다.
5. meter가 없는 첫 사용자는 이름, IANA timezone, 검침 마감만 입력해 meter를 생성합니다. owner identity와 resource ID는 client body에서 받지 않습니다.
6. owner 홈 빠른 입력은 현재 `Date.now()`와 decimal kWh를 reading API에 저장하고 성공 뒤 meter/readings를 다시 조회합니다. localStorage/offline write queue는 추가하지 않았습니다.
7. 최신 구간, 최근 완전 일자 평균, 현재 검침주기 평균, 마감 예상, 30일 환산, 이전 주기 비교, 일별 보간은 기존 순수 domain을 재사용합니다. 최신 raw reading이 오늘의 검침주기에 속하지 않으면 과거 cycle forecast를 현재 cycle 값처럼 표시하지 않습니다.
8. 검침 마감 UI는 `1..31` 또는 별도 `월말`입니다. 29~31일 고정값이 없는 달에는 domain이 그 달 실제 마지막 날을 사용하고, `월말`은 매달 실제 마지막 날을 사용합니다.
9. 전기요금 표시는 이 WorkUnit 이후의 tariff policy WorkUnit에서 추가되었으며, 이 WorkUnit 시점에는 정책 모듈이 없어 실제/샘플 금액을 표시하지 않았습니다.
10. Playwright는 API와 GIS를 deterministic하게 mock해 auth 미설정/signed-out 로그인, Google credential 실패 detail 비노출, owner quick write+reload, viewer read-only, 첫 meter 생성, API 실패, 월말 설정, 모바일 폭과 keyboard 흐름을 보호합니다.
11. 실제 Provider credential, production secret, 실사용자 데이터, sharing invitation, offline write/background sync, tariff는 이 baseline에 포함하지 않았습니다.

## 확정 운영 방향: 처음 만든 remote resource를 최종본까지 사용

- remote D1은 preview 전용 disposable database를 따로 만들지 않습니다.
- canonical database 이름은 `electricity-meter-tracker`, Worker binding 이름은 `DB`로 사용합니다.
- 한국 기본 사용 환경에 맞춰 최초 생성 location hint는 `apac`을 사용하되 별도 jurisdiction 제한은 두지 않습니다.
- 현재 `dev-electricity-meter-tracker.247dev.workers.dev` 개발 진입점과 향후 production origin이 같은 canonical D1을 사용합니다.
- remote canonical D1에는 synthetic fixture/mock/test data를 넣지 않습니다. 자동 fixture는 계속 local D1/workerd에서만 사용합니다.
- remote DB schema 변경은 versioned migration으로만 적용하며 임의 SQL 수정이나 실제 data dump commit은 하지 않습니다.
- Google Web Client도 최종용 하나를 사용합니다. 현재 dev origin을 Authorized JavaScript origin으로 등록하고 production origin이 확정되면 같은 client에 origin을 추가합니다.
- `SESSION_SECRET`은 repository 밖 Cloudflare secret으로만 저장합니다.
- `GOOGLE_CLIENT_ID`와 `SESSION_TTL_SECONDS`는 실제 값이 확인/결정된 뒤 `scripts/configure-auth-runtime.mjs`로 root public vars에 기록합니다.
- session TTL은 제품/security policy이므로 저장소가 임의 기본값을 정하지 않습니다. 지원 범위는 기존 session contract와 동일하게 60초~31일입니다.

자세한 provisioning 계약은 `docs/REMOTE_PROVISIONING.md`를 따릅니다.

## 완료 WorkUnit: canonical D1 실제 생성·binding·migration

- Cloudflare 계정에서 기존 동일 이름 D1이 없음을 확인한 뒤 `electricity-meter-tracker`를 `apac` location hint로 한 번 생성했습니다.
- 실제 database ID를 root `wrangler.jsonc`의 `DB` binding에 기록하고 `migrations/0001_initial.sql`을 canonical remote D1에 적용했습니다.
- migration 재조회에서 미적용 항목이 없고, metadata-only query로 `users`, `meters`, `meter_members`, `readings`, `d1_migrations` 테이블을 확인했습니다.
- canonical remote D1에는 local fixture나 synthetic user/meter/reading을 넣지 않았습니다.

## 완료 WorkUnit: Google auth runtime repository preflight

- `scripts/configure-auth-runtime.mjs`가 실제 Google Web Client ID와 명시적인 session TTL만 root `vars`에 기록합니다.
- `SESSION_SECRET`은 root config에 기록하지 않으며 `--check-env` 검증도 값 자체를 출력하지 않습니다.
- helper는 잘못된 Client ID/TTL, 기존 다른 Client/TTL의 자동 덮어쓰기, root `SESSION_SECRET` 저장을 거부합니다.
- `npm run test:provisioning`과 GitHub Actions가 D1 binding/local 격리와 auth runtime guard를 함께 보호합니다.

## 완료 WorkUnit: 최종용 Google Web Client + dev preview 실사용자 E2E

- 최종용 Google Web Client(`776785201029-mkh90fhobv7ltgu4nu0q15fsnr72qkp2.apps.googleusercontent.com`)를 생성하고 `https://dev-electricity-meter-tracker.247dev.workers.dev`를 Authorized JavaScript origin으로 등록했습니다.
- 명시적 session TTL로 14일(`1209600`초)을 결정하고 root `wrangler.jsonc`의 public vars에 반영했습니다.
- 최소 32바이트 이상의 암호학적으로 강력한 `SESSION_SECRET`을 repository 밖 Cloudflare runtime에 주입하고, `dev` preview alias로 새 Worker version을 업로드했습니다 (production traffic 불변).
- Remote Google JWKS fetch 처리 및 에러 진단 개선을 통해 Google Provider 로그인 flow를 안정화했습니다.
- 고정 dev origin에서 실제 Google 로그인 → first user 자동 생성 → first meter 생성 → 실제 reading 저장 → F5 새로고침 복원 → 로그아웃 후 보호 API 차단 → 동일 Google 계정 재로그인 시 기존 user/meter/reading 복원 전체 E2E DoD를 검증 완료했습니다.
- canonical remote D1에는 synthetic fixture나 임의 dump를 넣지 않았으며, 실제 사용자 데이터 및 Secret/토큰을 저장소나 로그에 노출하지 않았습니다.

## 완료 WorkUnit: PWA installability repository contract

- `index.html`의 과거 UI demo/sample metadata를 live product 문구로 교체하고 manifest/apple-touch-icon 연결을 추가했습니다.
- `public/manifest.webmanifest`는 root app identity, root `start_url`/`scope`, `standalone` display, theme/background와 일반 192/512 + maskable 512 아이콘을 명시합니다.
- `public/icons/`에는 외부 asset 없이 직접 생성한 PNG만 사용하며 iOS용 180 apple-touch-icon을 별도로 둡니다.
- `tests/pwa.spec.ts`는 built preview에서 manifest 선언, icon 응답/PNG signature/실제 pixel dimension, stale demo metadata 제거를 검증합니다.
- installability만 추가했으며 service worker/offline cache/offline write queue/Background Sync는 제품 요구가 확인되기 전까지 보류합니다.
- 특정 OS/browser의 실제 install promotion/standalone 실행은 repository test만으로 단정하지 않고 필요 시 해당 runtime에서 별도 검증합니다.

자세한 범위와 검증 경계는 `docs/PWA_INSTALLABILITY.md`를 따릅니다.

## 완료 WorkUnit: Google auth error boundary hardening

- `/api/auth/google`은 verifier/provider 예외의 상세 message를 public JSON에 포함하지 않고 기존 `401 / INVALID_GOOGLE_CREDENTIAL`과 고정 일반 메시지만 반환합니다.
- server diagnostic은 verifier 오류 이름/message를 유지하되 실제 Google credential 문자열이 포함되면 `[credential redacted]`로 치환하고 진단 길이를 제한합니다.
- Worker dependency에 테스트 전용 log sink 주입점을 두어 public response와 server diagnostic의 분리를 결정적으로 검증합니다.
- frontend는 `INVALID_GOOGLE_CREDENTIAL`에 대해 server-provided message를 재사용하지 않고 고정된 사용자용 안내만 표시합니다.
- Worker 테스트는 provider detail이 server diagnostic에는 남고 credential/public response에는 남지 않는 계약을 검증합니다.
- Playwright는 서버가 상세 message를 반환하는 보수적 mock에서도 해당 detail이 UI에 노출되지 않는 방어 경계를 검증합니다.

## 완료 WorkUnit: 주택용 전기요금 policy v1

- `src/domain/tariff.ts`가 usage/billing/calendar를 import하지 않는 독립 policy 모듈로 policy version(effective window, 공식 출처 provenance, 저장소 확인일), 계절별 누진 구간, 기본요금, 전력량요금 계산과 registry 검증을 소유합니다.
- v1 데이터는 2026-09-09에 한국전력 사이버지점 요금표와 찾기쉬운 생활법령정보에서 직접 확인한 주택용(저압) 2023-11-09 개정 수치(하계 300/450, 기타계절 200/400, 기본요금 910/1,600/7,300원, 전력량요금 120.0/214.6/307.3원/kWh)만 사용합니다.
- 검증 근거가 부족한 연료비조정요금, 기후환경요금, 부가가치세, 전력산업기반기금, 복지할인(구 필수사용량보장공제), 1,000kWh 초과 누진할증, 동계 소용량 할인, TV수신료는 계산에 넣지 않고 `excludedComponents`로 명시하며 결과는 기본요금+전력량요금 추정 소계로만 표시합니다.
- 홈 예상 전기요금은 마감 예상 사용량을 policy에 넣은 추정 소계와 provenance 문구(개정적용일, 확인일, 미반영 항목)를 표시하고, 미커버 마감 월은 기존 `요금 정책 연결 전`, 계산 근거가 없으면 `자료 부족`을 유지합니다.
- `domain-tests/tariff.test.mjs`가 공식 표 기대값으로 구간 경계, 계절 차이, 반올림 half-up 경계, 미커버 월, invalid 입력, registry 위반을 검증하고 `tests/ui.spec.ts`가 고정 시각 mock에서 정확한 원 단위와 provenance 문구 렌더링을 검증합니다.
- 계절은 검침 마감 월 기준 선택, 반올림은 전체 전력량요금 합에 1원 half-up 1회라는 v1 규칙과 실제 청구액 대조 한계를 `docs/TARIFF_POLICY.md`에 기록했습니다.

## 완료 WorkUnit: 주택용 전기요금 policy v2 (공식 근거 component 확장)

- `src/domain/tariff.ts`의 기존 `TariffPolicyVersion/TARIFF_POLICIES` 구조를 확장해, 2026-09-09에 공식 원문으로 직접 확인한 component만 계산에 편입했다. usage/billing/calendar domain은 수정하지 않았다.
- 신규 편입: 기후환경요금 9.0원/kWh(약관 별표7, 2023-01-01부터), 연료비조정요금 +5.0원/kWh(2026-04~06과 2026-07~09 분기 window, 한전 공시·한전ON 고지), 부가가치세 10%(과세기준 전기요금, 원 단위 4사5입), 전력산업기반기금(10원 미만 절사, 요율 3.7%→3.2%→2.7% window), 슈퍼유저요금(여름철·겨울철 1,000kWh 초과분 736.2원/kWh, 별표1 가.(5)), 월간 최저요금 1,000원(별표1 가.(3)).
- 모든 변동 component는 `TARIFF_PER_KWH_COMPONENTS`/`TARIFF_TAX_RATES`의 명시적 effective window와 source·confirmedOn을 가진다. 고지되지 않은 분기(2026-10 이후 4분기 등)의 연료비조정요금은 자동 연장하지 않고 해당 마감 월의 `excludedComponents`로 표시한다.
- 계산 순서는 약관 제67조(전기요금 = 기본+전력량+기후환경+연료비)와 한전ON 공식 계산식(VAT/기금 모두 전기요금 기준, 청구 합계 10원 미만 절사, 약관 제7조②)를 따르며, 항목별 곱은 BigInt 1/10,000원 단위 누적 후 1원 half-up 1회라는 저장소 규칙을 문서화했다.
- 동계 소용량 할인은 현행 약관 별표1 가.(4) `<삭 제>`와 생활법령정보 2026-08-15 할인 목록으로 obsolete/not-applicable로 판정해 excluded 목록에서 제거했고, 복지할인(자격 입력 필요)과 TV수신료(약관 제82조 병기청구)는 계속 별도/미반영으로 둔다.
- `domain-tests/tariff.test.mjs`가 60개 테스트로 component window 유효성, 최저요금, 999/1,000/1,001kWh 슈퍼유저 경계(하계·동계 적용/기타계절 미적용), 연료비 분기 window(2026-06은 2분기 window, 2026-10은 미커버), VAT 4사5입 경계, 기금 요율 window별 10원 절사, 예상 합계 10원 절사를 검증한다.
- 홈 UI는 예상 합계 원 단위와 함께 policy label·확인일·포함 항목·연료비 고지 window와 단가(+5.0원/kWh)·미반영 항목을 note로 표시하며, "예상 전기요금" 문구를 유지한다. `tests/ui.spec.ts` 기대값을 148,500 원 기준으로 갱신했다.

## 확정 방향: 전기 / 가스 계량기

- 같은 앱에서 ready UI 상위에 `[전기] [가스]` utility switch를 두고 기존 `홈 / 기록 / 분석 / 설정`과 utility별 meter selector를 재사용한다.
- 가스 사용자-facing 명칭은 `가스`로 통일한다.
- 현재 runtime은 전기만 지원하므로 schema/API/domain 없이 빈 가짜 가스 탭만 먼저 추가하지 않는다.
- 기존 meter는 gas migration 시 모두 `electricity`로 보존하고, meter의 utility 종류는 생성 후 변경 불가로 한다.
- 현재 `readings.cumulative_wh`, API `cumulativeWh/cumulativeKwh`, domain `usageWh/averagePowerW`는 전기 전용 의미다. gas 값을 여기에 억지로 넣지 않고 versioned D1 migration + neutral raw counter contract를 먼저 만든다.
- 권장 raw storage 의미는 meter base unit의 1/1000 정수 `cumulative_milliunit`: 전기 1 = 1 Wh, 가스 1 = 0.001 m³. 기존 electricity `cumulative_wh` 값은 숫자 변환 없이 1:1 보존 가능하다.
- 공통 cumulative delta/time/date/billing/forecast scalar와 전기 전용 W/kWh/tariff, 가스 전용 m³/m³·h/gas tariff를 분리한다.
- gas usage/forecast는 tariff 없이 먼저 완성할 수 있다. 예상 가스요금은 공급사/지역/effective tariff provenance가 확인된 범위에서만 붙인다.
- gas tariff를 위해 처음부터 사용계약번호·상세주소를 수집하지 않는다. 공급사/지역 선택으로 충분한지 먼저 검토한다.

세부 계약과 공식 도시가스 요금 구조 근거는 `docs/GAS_METER_DIRECTION.md`를 따른다.

## 다음 1순위 후보

1. **가스 foundation migration** — `utilityKind` meter contract + 기존 meter electricity backfill + raw reading neutral fixed-point migration + API resource/input 정합화. canonical D1 값 보존, schema/local workerd/Worker 회귀를 같은 WorkUnit에서 완료.
2. **공통 counter/domain core + gas usage** — 전기 결과를 바꾸지 않는 unit-neutral cumulative/interval/calendar/billing/forecast scalar 추출, gas m³/m³·h adapter와 경계 테스트 추가.
3. **실제 `[전기] [가스]` UI** — utility별 meter 생성/선택/empty state, gas quick input, 기록/분석/설정 단위 전환, 320px/iPhone/keyboard/owner-viewer 회귀. 1·2 완료 전 빈 탭만 추가하지 않음.
4. **gas tariff policy** — provider/지역/effective window/보정계수·평균열량·원/MJ·기본료·VAT 공식 provenance를 가진 별도 모듈. 공급사/지역 입력 UX가 실제 제품 계약을 갈라놓을 때만 Discussion Gate.
5. 실제 owner/viewer 공유 초대/해제 UI와 관리 API(초대 수단/데이터 모델 확정이 필요한 Discussion Gate).
6. 복지할인 optional policy(대상/한도 공식 matrix 확인과 사용자 자격 입력 UX/개인정보 계약이 필요한 별도 후속, Discussion Gate).
7. 2026년 4분기 연료비조정단가 공시 확인 시 fuel window 추가와 confirmedOn 갱신.
8. 요금 항목별 원단위 처리의 법령/시행세칙 원문 확인(현재는 한전ON 공식 계산식 + 저장소 규칙 병기).

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
