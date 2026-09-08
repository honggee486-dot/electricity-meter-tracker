# electricity-meter-tracker

전기 계량기 누적값을 임의 시점에 빠르게 기록하는 모바일 중심 웹앱.

## 현재 상태

**Architecture baseline + mobile UI prototype + 순수 usage/calendar/검침주기/forecast domain + 최소 Worker API shell + D1 schema/migration baseline** 단계입니다. UI의 초기 기록과 지표는 여전히 가상 SAMPLE / DEMO DATA이며 실제 저장·계산 결과와 연결되지 않았습니다.

- 홈 진입 → 현재 계량기 숫자 입력 → 기록하기. 별도 페이지나 모달이 필요하지 않습니다.
- 빈 값과 숫자 형식이 아닌 입력은 버튼 비활성화. UI는 소수점을 포함한 15자 이내 입력을 받지만 이 제한은 production 계량값 계약이 아닙니다.
- 체험 기록에는 현재 시각을 자동으로 붙여 기록 탭에 표시합니다. 메모리에만 존재하며 새로고침하면 사라집니다. localStorage, DB, 네트워크 저장은 없습니다.
- 홈 / 기록 / 분석 / 설정 하단 탐색, 읽기 전용 계량기 설정, 준비 중인 공유 UI.
- 구간 사용량·소비전력, 최근 일평균, 검침주기 평균, 마감 예상, 비교용 30일 환산을 분리해 표시합니다. 현재 UI 지표는 입력해도 바뀌지 않는 고정 샘플입니다.
- UI의 일별 경계 측정 / 추정·보간 표시는 아직 SAMPLE이지만, 실제 domain에는 계량기 timezone 기준 날짜 경계 분할과 선형 보간이 구현되어 있습니다. 실제 한전 요금표는 없으며 **예상 전기요금도 고정 샘플**입니다.
- `src/domain/usage.ts`는 누적값 정규화와 절대 instant 구간 계산을, `src/domain/calendar.ts`는 IANA timezone 기반 calendar 경계를, `src/domain/dailyUsage.ts`는 일자별 분할을, `src/domain/billingCycle.ts`는 검침 마감 설정·주기·경계 보간을, `src/domain/forecast.ts`는 최근/주기 평균·마감 예상·30일 환산·이전 주기 비교와 신뢰도 evidence를 소유합니다.
- `src/worker.ts`는 동일-origin API request owner이며 현재는 deterministic `GET /api/health`와 최소 JSON error envelope만 제공합니다. 실제 D1 binding/auth/CRUD는 아직 없습니다.
- `migrations/0001_initial.sql`은 `users`, `meters`, `meter_members`, `readings`의 첫 D1 schema baseline입니다. 실제 Cloudflare D1 database를 생성하거나 연결하지는 않았습니다.
- 개발용 preview는 Cloudflare Workers Builds와 연결되어 있습니다. `main`은 production 기준, `work/*`는 non-production preview이며 고정 개발 주소는 `https://dev-electricity-meter-tracker.247dev.workers.dev`입니다. Dashboard 설정은 저장소 밖 상태이므로 문제 조사 시 실제 Cloudflare 설정을 다시 확인합니다.

## 실행과 검증

Node.js `^20.19.0 || >=22.12.0`, npm을 사용합니다. lockfile을 커밋해 개발 의존성을 고정합니다.

```sh
npm ci
npm run dev
```

출력된 로컬 주소를 엽니다. 개발 서버는 기본 `127.0.0.1:5173`이며 외부로 공개하지 않습니다.

```sh
npm run build
python persistence-tests/schema_test.py
npm run test:worker
npm run test:domain
npx playwright install chromium webkit
npm run test:ui
```

- `npm run typecheck`: strict TypeScript 검사. Vite 변환과 별도로 실행합니다.
- `npm run build`: 타입 검사 후 `dist/` 정적 산출물 생성.
- `python persistence-tests/schema_test.py`: Python 표준 `sqlite3` in-memory DB에 `migrations/0001_initial.sql`을 적용해 table/index/foreign-key/uniqueness/check/cascade 계약을 검증합니다. 앱 runtime에는 Python dependency가 없습니다.
- `npm run test:worker`: `src/worker.ts`를 `.worker-test/`에 임시 컴파일하고 Node 내장 test runner로 health/error routing 계약을 검증합니다. `.worker-test/`는 커밋하지 않습니다.
- `npm run test:domain`: `src/domain`만 `.domain-test/`에 임시 컴파일한 뒤 Node 내장 test runner로 순수 domain 테스트를 실행합니다. `.domain-test/`는 커밋하지 않습니다.
- `npm run test:ui`: 이미 빌드된 `dist/`를 포트 4173 preview 서버로 열어 Playwright 브라우저 검증을 실행합니다. 소스 변경 후에는 먼저 build가 필요합니다.
- `npm test`: domain, Worker API, UI 테스트를 순서대로 실행합니다. persistence schema test는 별도 표준-library 검증이며 GitHub Actions에서 항상 함께 실행합니다. UI 테스트 전에는 `npm run build`가 선행되어야 합니다.
- Playwright는 iPhone 13 프로필의 Chromium/WebKit과 1440×900 데스크톱 Chromium에서 실행합니다. 긴 숫자는 390px 및 320px에서도 검사합니다.
- `.github/workflows/verify.yml`은 `main`, `work/**`, pull request에서 build, persistence schema, Worker API, UTC/Asia-Seoul domain, Chromium/WebKit UI 테스트를 검증합니다.
- 모바일 프로필은 브라우저 에뮬레이션입니다. 실제 iPhone 키보드, Safari 도구막대, 홈 인디케이터의 safe-area 동작은 실기기 증거가 아닙니다.

## 첫 usage domain 계약

현재 첫 계산 계약은 persistence/API public contract를 미리 고정하지 않는 내부 baseline입니다.

- 누적 계량값 입력은 부호 없는 decimal **kWh 문자열**로 받으며 최대 소수 3자리(1 Wh)까지 정확히 정수 Wh로 변환합니다.
- `0.1 + 0.2` 같은 부동소수점 오차가 누적값 차감에 들어오지 않도록 누적값과 구간 사용량의 기준 단위는 정수 Wh입니다.
- 최대값은 `Number.MAX_SAFE_INTEGER` Wh까지의 구현 안전 범위입니다. 실제 제품이 지원하는 계량기 최댓값을 의미하지 않습니다.
- 구간 계산의 측정 시각은 `measuredAtMs` Unix epoch milliseconds라는 **절대 instant**입니다. 서버/브라우저의 로컬 timezone은 구간 경과시간 계산에 관여하지 않습니다.
- 같은 누적값을 나중에 다시 기록하는 것은 0 Wh 사용 구간으로 허용합니다.
- 이전 기록보다 낮은 누적값과 동일/역전 측정 시각은 명시적 domain 오류로 거부합니다. meter 교체/reset은 아직 별도 정책이 없으므로 자동 해석하지 않습니다.
- `calculateUsageInterval`은 정확한 `usageWh`와 함께 kWh, elapsed milliseconds/hours, 평균 소비전력 W를 반환합니다.
- `splitUsageIntervalByLocalDate`는 명시적인 meter timezone으로 같은 날/자정/여러 날/월말/연말/윤년/DST 일자를 나누고 각 날짜 구간의 사용량을 시간비례 선형 보간합니다.
- 검침 마감은 1~31일 고정 일자 또는 별도 `month-end` 설정을 지원합니다. 고정 일자가 그 달에 없으면 그 달 마지막 날로 자동 보정하며, `month-end`는 항상 실제 월말을 의미합니다.
- `getBillingCycleContext`는 이전/현재/다음 검침주기와 남은 시간을 계산하고, 검침 경계값은 actual reading 우선 → 전후 actual reading 보간 → 자료 부족 시 미산출 순서입니다.
- `calculateUsageForecast`는 최근 구간, 최근 완전 일자 평균, 현재 검침주기 평균, 마감 예상, 30일 환산, 이전 주기 비교를 서로 다른 필드로 유지합니다. 최근 일평균의 window 길이는 caller가 명시해 숨은 7일 정책을 만들지 않습니다.
- 마감 예상은 현재 주기 시작 경계부터 최신 actual reading까지의 평균 소비율을 사용합니다. 시작 경계를 만들 수 없거나 관측 시간이 0이면 예상값을 `null`로 두고 억지 추정하지 않습니다.
- forecast 신뢰도는 임의의 등급 대신 관측 주기 비율, 사용한 완전 일자 수, 시작 경계 provenance, 최신 구간 길이, 이전 주기 availability 같은 객관 evidence를 반환합니다.
- 실제 reading endpoint는 `actual`, 사이 날짜 경계는 `interpolated` provenance를 갖습니다. 실제 reading이 정확히 경계에 있으면 별도 보간점을 만들지 않아 actual이 우선합니다.
- 보간 경계의 누적 Wh는 추정값이므로 fractional Wh가 될 수 있습니다. 원본 reading의 정수 Wh 계약은 바뀌지 않으며 일자별 구간 합은 원래 구간 총사용량을 수치 오차 범위에서 보존합니다.
- calendar 계산은 `Intl.DateTimeFormat`의 IANA timezone을 사용하며 별도 날짜 라이브러리를 추가하지 않았습니다. 순수 구간 계산 자체에는 timezone이 필요하지 않습니다.

## D1 persistence baseline

`migrations/0001_initial.sql`은 현재 첫 persistence contract입니다. 파생 사용량이나 forecast를 저장하지 않고 다시 계산 가능한 원본과 접근 관계만 저장합니다.

- `users`: 내부 `user_id`, unique `google_subject`, 생성 시각. Google email은 불변 identity key로 저장하지 않습니다.
- `meters`: 정확한 canonical owner `owner_user_id`, 이름, timezone, 검침 마감 설정, 생성/수정 시각.
- `meter_members`: 명시적으로 공유한 **viewer grant**만 저장합니다. owner는 이 테이블에 중복 저장하지 않고 `meters.owner_user_id`가 단일 source입니다.
- `readings`: `reading_id`, meter, 절대 `measured_at_ms`, 정수 `cumulative_wh`, 생성 시각만 저장합니다. 같은 meter의 정확히 같은 measured instant는 unique index로 차단합니다.
- owner별 meter, viewer별 shared meter, meter별 measured instant 조회에 필요한 최소 index만 둡니다. 불필요한 index는 D1 write amplification을 늘리므로 추가하지 않습니다.
- meter 삭제는 그 meter의 viewer grant와 reading을 cascade 삭제합니다. user 삭제는 참조 meter/member가 남아 있으면 막혀 orphan ownership을 만들지 않습니다.
- 누적값 역행 같은 순서 기반 검증은 SQL trigger로 중복 구현하지 않고 현재 usage/API domain에서 강제합니다.

## 최소 frontend 결정

| 후보 | 현재 요구와의 판단 |
| --- | --- |
| Plain HTML/CSS/JavaScript | 빌드 의존성이 없어 가장 간단하나, 향후 순수 계산 입력·결과와 API 계약의 타입 검사가 없어 유지 비용이 늘어날 수 있음 |
| **Vite + TypeScript + 기본 DOM/CSS** | 채택. 화면 4개를 위한 런타임 프레임워크 없이 타입 검사, 모듈, 로컬 서버, 정적 build를 확보 |
| React / Next.js / Vue / Svelte 등 | 보류. 현재는 복잡한 반응형 상태, SSR, 서버 라우팅 요구가 없어서 추가 런타임·도구 체계의 이점이 작음 |

직접 개발 의존성은 Vite, TypeScript, Playwright 세 개이며 앱의 런타임 의존성은 없습니다. domain/Worker API 테스트는 Node 내장 test runner를 사용하고 persistence migration 검증은 Python 표준 `sqlite3`만 사용해 새 test dependency를 추가하지 않습니다. 외부 폰트·아이콘·차트 라이브러리·CDN을 사용하지 않습니다.

## 책임 경계

| Owner | 현재 / 향후 책임 |
| --- | --- |
| `src/main.ts`, `src/style.css` | 현재 화면 렌더링, 입력 형식, 탐색, 임시 체험 기록. 향후 UI는 domain 결과와 API 응답을 표현 |
| `src/demo.ts` | 현재 모든 가상 초기 기록·지표·계량기 설정의 단일 원본. 실제 domain 결과로 취급하지 않음 |
| `src/domain/usage.ts` | DOM, Worker, DB에 의존하지 않는 누적값 정규화, 절대 instant reading, 구간 사용량·경과시간·평균 소비전력 |
| `src/domain/calendar.ts` | IANA timezone 기준 local-date 변환, 월 길이, local midnight instant 등 공용 calendar primitive |
| `src/domain/dailyUsage.ts` | 계량기 timezone 기준 날짜 경계 분할/보간, `actual / interpolated` provenance |
| `src/domain/billingCycle.ts` | 1~31일/월말 검침 설정, 실제 마감일 보정, 이전/현재/다음 주기, 경계 actual 우선/보간, 주기 사용량 |
| `src/domain/forecast.ts` | 최신 구간 pace, caller 지정 최근 완전 일자 평균, 현재 주기 평균, 마감 예상, 30일 환산, 이전 주기 비교, 객관 confidence evidence |
| `src/worker.ts` | 동일-origin Worker module entry, API route/method dispatch, 최소 JSON response/error envelope. 향후 auth/persistence 경계는 이 owner에서 조립하되 domain을 오염시키지 않음 |
| `migrations/` | D1 schema/migration source. 현재는 users/meters/viewer grants/raw readings와 DB-level integrity/index 계약만 소유 |
| 향후 persistence module | D1 binding, parameterized query, DB row↔API/domain 입력 경계. UI/domain에서 SQL이나 Cloudflare binding을 직접 사용하지 않음 |
| 향후 tariff policy | usage와 별도 모듈. 정책 version/effective date, 누진·계절·기본요금·조정요금·세금·기금·반올림을 소유 |
| 향후 auth | Google 공급자의 안정적 subject identifier와 내부 user_id 연결. 이메일은 불변 identity가 아님. 서버에서 세션 검증 |

## 향후 production 방향

```text
Frontend / 향후 PWA
  → Cloudflare Workers Static Assets
  → 동일 origin의 Worker /api 경계
  → D1
```

`wrangler.jsonc`는 `./dist` Static Assets와 `src/worker.ts` module entry를 함께 배포하고 `/api/*`만 Worker-first로 라우팅합니다. 정적 asset 요청은 기본 asset-first 경로를 유지합니다. **D1 binding/database, Google OAuth는 아직 없습니다.** Workers Builds Git 연동과 non-production preview는 사용하지만 정식 production 릴리스는 아직 하지 않았습니다.

2026-09-08 Cloudflare 공식 문서 확인 기준 Workers Free는 Worker 실행 요청 100,000회/일, HTTP 요청당 CPU 10 ms이고 Static Assets 요청은 무료·무제한입니다. Static Assets는 Free에서 Worker version당 20,000 files, 개별 파일 25 MiB 제한입니다.

같은 날 다시 확인한 D1 Workers Free 기준은 **5,000,000 rows read/day, 100,000 rows written/day, 계정 총 5 GB, database당 500 MB, account당 10 databases, Worker invocation당 최대 50 D1 queries**입니다. Free의 일일 read/write 또는 storage 한도에 도달하면 D1 query가 실패하며 자동 유료 과금으로 전환되지 않습니다. D1 data egress 요금은 없습니다. index도 storage/write를 사용하므로 실제 access path에 필요한 최소 index만 유지합니다.

실제 제품 dependency 근거는 Cloudflare 공식 문서를 사용하며 이번 확인 기준일은 `2026-09-08`입니다.

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- https://developers.cloudflare.com/d1/reference/migrations/

검침 의미: 21일 마감의 표시 기간은 전월 22일~당월 21일입니다. 설정은 1~31일 또는 별도 월말을 지원하며, 고정 일자가 없는 달에는 해당 월 마지막 날을 실제 마감일로 사용합니다. 경계값은 실제 경계 기록 → 전후 기록 보간 → 자료 부족 시 미산출 순서입니다. 최근 구간 소비 속도, 최근 일평균, 주기 평균, 마감 예상, 30일 환산은 서로 다른 값으로 유지합니다.

이번 단계에 없는 기능: UI와 실제 domain/API 연결, 실제 전기요금 계산, 검침 마감 설정 UI, Google OAuth·사용자 생성·세션, 실제 D1 binding/query adapter/remote database, 실제 meter/readings CRUD, 실제 공유 관리 UI, production service worker·push·background sync·정식 production 배포.

## Public 저장소

실제 계량기 기록, 개인정보, 로그, DB dump, 쿠키, token, secret, 실제 `.env`를 포함하지 않습니다. 의존성 출처·버전·integrity는 `package-lock.json`에 보존합니다. `AGENTS.md`의 작업/Git/보안 규칙을 따릅니다.
