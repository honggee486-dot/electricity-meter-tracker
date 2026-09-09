# electricity-meter-tracker

현재는 전기 계량기 누적값을 임의 시점에 빠르게 기록하는 모바일 중심 웹앱이며, 다음 제품 확장으로 같은 앱에서 `전기 / 가스` 계량기를 전환해 기록하는 방향을 채택했습니다. 현재 runtime은 전기만 지원합니다.

## 현재 상태

**Architecture baseline + live mobile UI + 순수 usage/calendar/검침주기/forecast domain + Worker API + D1 persistence/runtime + Google identity/session + server-side owner/viewer meter/readings CRUD + canonical remote D1 baseline** 단계입니다. UI는 더 이상 `src/demo.ts`의 고정 SAMPLE을 정본으로 사용하지 않고 same-origin API의 raw meter/readings와 기존 순수 domain 계산을 사용합니다.

- 다음 제품 확장은 상위 `[전기] [가스]` utility switch이며, 기존 전기 meter/readings는 그대로 보존합니다. 현재 `Wh/kWh` 전용 schema/API/domain에 가스 값을 억지로 넣지 않고 versioned D1 migration과 unit-neutral raw counter contract를 먼저 만듭니다. 세부 계약은 `docs/GAS_METER_DIRECTION.md`를 따릅니다.
- 인증 환경 미설정 / signed-out / signed-in / loading / API error를 구분하며 Google Client ID가 실제 환경에 있을 때만 GIS 로그인 버튼을 로드합니다.
- 로그인 사용자는 접근 가능한 owner/viewer meter만 선택합니다. owner는 기록·설정 mutation이 가능하고 viewer는 조회 전용이며 최종 권한 판정은 계속 서버/API에서 강제합니다.
- 첫 사용자는 계량기 이름, IANA timezone, 검침 마감만 입력해 첫 meter를 만들 수 있습니다. owner identity와 resource ID는 client body에서 받지 않습니다.
- 홈의 빠른 입력은 현재 시각 + 누적 kWh를 raw reading API에 저장한 뒤 최신 raw readings를 다시 읽습니다. localStorage, offline write queue, 파생값 DB 저장은 없습니다.
- 홈 / 기록 / 분석 / 설정 하단 탐색을 유지하며 실제 raw reading을 usage/daily/billing/forecast domain에 넣어 구간 사용량·소비전력·최근 일평균·검침주기·마감 예상·30일 환산을 계산합니다.
- owner 설정은 검침 마감 `1~31일 + 월말`을 지원합니다. 29~31일 고정값이 없는 달은 그 달 실제 월말로 자동 보정하며 `월말`은 항상 매달 마지막 날입니다.
- 홈 예상 전기요금은 `src/domain/tariff.ts`의 주택용(저압) 2023-11-09 개정 policy(2026-09-09 공식 출처 확인)로 기본요금·전력량요금·기후환경요금·연료비조정요금(분기 고지 window)·부가가치세(원단위 4사5입)·전력산업기반기금(10원 절사, 요율 window)·월간 최저요금을 더한 예상 합계(10원 미만 절사)를 계산하고, 여름철·겨울철 1,000kWh 초과분에는 슈퍼유저요금 736.2원/kWh를 적용합니다. 복지할인과 TV수신료, 공식 고지가 없는 분기의 연료비조정요금은 미반영 항목으로 명시하고 실제 청구액처럼 표시하지 않습니다. policy가 커버하지 않는 마감 월은 요금 정책 미연결 표시를 유지합니다. 자세한 provenance와 계산 규칙은 `docs/TARIFF_POLICY.md`를 따릅니다.
- `src/api.ts`는 frontend same-origin HTTP 경계를 소유하고 SQL/D1 세부를 알지 않습니다.
- `src/domain/usage.ts`는 누적값 정규화와 절대 instant 구간 계산을, `src/domain/calendar.ts`는 IANA timezone 기반 calendar 경계를, `src/domain/dailyUsage.ts`는 일자별 분할을, `src/domain/billingCycle.ts`는 검침 마감 설정·주기·경계 보간을, `src/domain/forecast.ts`는 최근/주기 평균·마감 예상·30일 환산·이전 주기 비교와 신뢰도 evidence를, `src/domain/tariff.ts`는 usage와 분리된 전기요금 policy(version/effective window, 공식 출처 provenance·확인일, 누진·계절·기본요금, 기후환경·연료비·부가세·기금·최저요금·슈퍼유저요금, 반올림과 명시적 미반영 항목)를 소유합니다.
- `src/persistence/d1.ts`는 D1-compatible prepared query와 DB row 검증 경계를 소유합니다. Google subject/internal user, owner/viewer access lookup, meter/readings CRUD와 reading 이웃 조회를 담당합니다.
- `src/auth/google.ts`는 Google GIS ID token의 RS256/JWK 서명과 issuer/audience/expiry/subject를 검증하고, `src/auth/session.ts`는 Web Crypto HMAC으로 `__Host-em_session` cookie를 서명·검증합니다.
- `src/worker.ts`는 동일-origin API request owner입니다. health/auth baseline과 `/api/meters*` product API를 제공하며 모든 meter/readings route에서 내부 session과 owner/viewer 권한을 서버에서 강제합니다. local D1/auth 검증 probe는 명시적 local gate가 없으면 404입니다.
- `migrations/0001_initial.sql`은 `users`, `meters`, `meter_members`, `readings`의 첫 D1 schema baseline입니다. canonical Cloudflare D1은 실제 계정에 생성되어 root `DB` binding으로 연결됐고 `0001_initial.sql` remote migration도 적용됐습니다. synthetic fixture는 remote canonical D1에 넣지 않습니다.
- `wrangler.local.jsonc`, `persistence-tests/local_fixture.sql`, `persistence-tests/local_runtime_check.sh`는 local D1/workerd 검증 전용입니다. root `wrangler.jsonc`의 canonical remote D1과 분리되어 있으며 local config를 배포 대상으로 사용하지 않습니다.
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
npm run test:provisioning
python persistence-tests/schema_test.py
npm run test:worker
npm run test:domain
npx playwright install chromium webkit
npm run test:ui
```

- `npm run typecheck`: strict TypeScript 검사. Vite 변환과 별도로 실행합니다.
- `npm run build`: 타입 검사 후 `dist/` 정적 산출물 생성.
- `npm run test:provisioning`: canonical remote D1 binding/local D1 격리와 Google auth runtime public vars/TTL/secret 경계를 검증합니다. 실제 Secret이나 Provider 호출은 하지 않습니다.
- `python persistence-tests/schema_test.py`: Python 표준 `sqlite3` in-memory DB에 `migrations/0001_initial.sql`을 적용해 table/index/foreign-key/uniqueness/check/cascade와 실제 persistence access/CRUD query-plan/index 계약을 검증합니다. 앱 runtime에는 Python dependency가 없습니다.
- `npm run test:worker`: `src/worker.ts`와 직접 import되는 persistence/auth/domain module을 `.worker-test/`에 임시 컴파일하고 Node 내장 test runner로 health/error routing, Google JWT signature/claims, session tamper/expiry, GIS CSRF, first-login persistence, owner/viewer/outsider authorization, meter/readings CRUD와 입력 검증을 검증합니다. `.worker-test/`는 커밋하지 않습니다.
- `npm run test:domain`: `src/domain`만 `.domain-test/`에 임시 컴파일한 뒤 Node 내장 test runner로 순수 domain 테스트를 실행합니다. `.domain-test/`는 커밋하지 않습니다.
- `npm run test:ui`: 이미 빌드된 `dist/`를 포트 4173 preview 서버로 열어 Playwright 브라우저 검증을 실행합니다. deterministic API/GIS mock으로 auth 미설정/signed-out/login, owner quick write+reload, viewer read-only, 첫 meter 생성, API failure, 월말 설정, 모바일 폭과 keyboard 흐름을 보호합니다. 소스 변경 후에는 먼저 build가 필요합니다.
- `npm test`: provisioning, domain, Worker API/persistence/auth/resource, UI 테스트를 순서대로 실행합니다. persistence schema test와 Wrangler local D1/workerd round trip은 GitHub Actions에서 별도 단계로 항상 함께 실행합니다. UI 테스트 전에는 `npm run build`가 선행되어야 합니다.
- Playwright는 iPhone 13 프로필의 Chromium/WebKit과 1440×900 데스크톱 Chromium에서 실행합니다. 긴 숫자는 390px 및 320px에서도 검사합니다.
- `.github/workflows/verify.yml`은 `main`, `work/**`, pull request에서 build, canonical provisioning contract, persistence schema/query plan, Worker API/persistence/auth/resource, pinned Wrangler `4.129.0` local D1/workerd round trip, UTC/Asia-Seoul domain, Chromium/WebKit UI 테스트를 검증합니다.
- `persistence-tests/local_runtime_check.sh`는 동일한 local persistence directory에서 D1 migration과 synthetic fixture를 적용한 뒤 persistence/auth probe와 synthetic owner/viewer/outsider signed session을 사용한 meter/readings CRUD HTTP round trip을 실행합니다. root product config에서는 두 dev probe가 모두 404로 닫혀 있는지 확인하며 remote D1이나 배포는 사용하지 않습니다.
- GitHub Actions의 local D1/workerd 검증은 실제 Cloudflare local runtime evidence이지만 Linux runner에서 수행되므로 Windows 고유 filesystem/process 동작의 증거로 확대 해석하지 않습니다.
- 모바일 프로필은 브라우저 에뮬레이션입니다. 실제 iPhone 키보드, Safari 도구막대, 홈 인디케이터의 safe-area 동작은 실기기 증거가 아닙니다.

## 첫 usage domain 계약

현재 첫 계산 계약은 persistence/API public contract를 미리 고정하지 않는 내부 baseline이며, **현재 전기 runtime의 단위 계약**입니다. 가스 확장에서는 이 Wh/kWh 필드에 다른 단위를 넣지 않고 `docs/GAS_METER_DIRECTION.md`의 migration 순서를 따릅니다.

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
- owner meter, viewer grant, resource access, meter reading 시간순·이웃·exact instant 조회에 필요한 현재 index만 둡니다. `EXPLAIN QUERY PLAN` regression test가 CRUD/access path가 기존 index를 재사용하는지 확인합니다.
- `src/persistence/d1.ts`의 모든 동적 query 값은 D1 prepared statement binding으로 전달합니다. 문자열 연결로 SQL 값을 삽입하지 않습니다. 최초 로그인 user는 `INSERT OR IGNORE` 후 Google subject를 재조회해 동일 subject의 canonical 내부 user를 얻습니다.
- persistence row는 호출자에게 넘기기 전에 문자열, safe integer, 검침 마감 의미를 검사합니다. DB 손상·잘못된 row가 조용히 domain 입력으로 흘러가지 않도록 `PersistenceDataError`로 실패합니다.
- meter 삭제는 그 meter의 viewer grant와 reading을 cascade 삭제합니다. user 삭제는 참조 meter/member가 남아 있으면 막혀 orphan ownership을 만들지 않습니다.
- 누적값 역행 같은 순서 기반 검증은 SQL trigger로 중복 구현하지 않고 usage/API domain에서 강제합니다.
- `wrangler.local.jsonc`의 D1 ID와 fixture는 local-only test material입니다. 실제 remote D1 resource ID나 사용자 데이터가 아닙니다.
- root `wrangler.jsonc`의 `DB`는 최종 운영본까지 유지할 canonical remote D1을 가리킵니다. remote schema는 versioned migration으로만 변경하고 synthetic fixture를 적용하지 않습니다.

현재 schema의 `cumulative_wh`는 전기 전용 의미이므로 가스 지원 전에 versioned migration으로 neutral fixed-point raw reading 의미로 이동합니다. 기존 전기 값은 산술 변환 없이 보존하는 방향을 우선합니다.

## Google identity/session baseline

- 로그인 공급자는 Google Identity Services만 대상으로 합니다. 자체 이메일/비밀번호 회원가입은 없습니다.
- GIS `credential` ID token은 Google JWK의 RS256 signature와 `iss`, `aud`, multi-audience `azp`, `exp`, optional `nbf`, `sub`를 Worker 경계에서 검증합니다. Google signing key는 응답 `Cache-Control`에 맞춰 캐시하고 `kid` 미일치 시 한 번 refresh합니다.
- 공급자 identity의 canonical key는 Google `sub`이며 email은 불변 user ID로 취급하지 않습니다.
- login POST의 `g_csrf_token`은 cookie/body double-submit 값이 정확히 하나씩 존재하고 같아야 합니다. frontend GIS callback 경로도 same-origin token을 cookie/body에 함께 전달해 동일 서버 검증을 재사용합니다. 로그인 POST는 `application/x-www-form-urlencoded`와 제한된 body 크기만 허용합니다.
- 최초 정상 로그인은 내부 UUID 후보를 만들고 D1의 unique Google subject 계약을 이용해 한 user row로 수렴합니다. 재로그인은 기존 내부 `user_id`를 재사용합니다.
- 앱 session은 `__Host-em_session` cookie이며 Web Crypto HMAC-SHA256 서명, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, Domain 미설정 계약입니다. `SESSION_SECRET`과 `SESSION_TTL_SECONDS`는 환경에서 주입하며 실제 Secret을 저장소에 넣지 않습니다.
- canonical remote D1과 최종용 Google Web Client ID, repository 밖 Cloudflare secret으로 주입한 `SESSION_SECRET`, 명시적 session TTL이 구성됐고 dev preview origin에서 실제 Google Provider 로그인 → first user/meter 생성 → 저장 → 재로그인 복원 E2E가 검증됐습니다. `.dev.vars`와 실제 `.env`는 Git에서 제외합니다.
- `scripts/configure-auth-runtime.mjs`는 실제 Google Web Client ID와 명시적인 TTL만 root public vars에 기록하고 `SESSION_SECRET`을 저장소에 넣지 않습니다. 이미 다른 Client ID/TTL이 있으면 자동 덮어쓰지 않습니다.
- Google GIS 서버 검증 근거는 `2026-09-08` 확인한 Google 공식 문서, Worker crypto/secret 근거는 같은 날 확인한 Cloudflare 공식 문서입니다.
  - https://developers.google.com/identity/gsi/web/guides/verify-google-id-token
  - https://developers.google.com/identity/gsi/web/reference/html-reference
  - https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
  - https://developers.cloudflare.com/workers/configuration/secrets/

## server-side meter/readings API baseline

- 모든 `/api/meters*` product route는 유효한 서명 session과 D1 내부 user 존재를 먼저 확인합니다.
- `GET /api/meters`는 로그인 user가 owner인 meter와 명시적으로 공유받은 viewer meter만 반환합니다.
- `GET /api/meters/:meterId`와 reading 조회는 owner/viewer가 가능하고, 접근권한이 없는 user와 실제로 존재하지 않는 resource는 같은 404 응답으로 처리합니다.
- viewer가 이미 공유받아 존재를 알 수 있는 meter에 mutation을 요청하면 403이며, owner만 meter 설정과 raw reading을 생성·수정·삭제할 수 있습니다.
- meter 생성 body는 `name`, `timezone`, `billingClose`만 받습니다. `owner_user_id`와 resource ID는 session/server가 결정하므로 client가 owner identity를 주입할 수 없습니다.
- 검침 설정은 `{ kind: 'day', day: 1..31 }` 또는 `{ kind: 'month-end' }`이며 IANA timezone과 함께 기존 domain으로 검증합니다. 고정 날짜가 없는 달은 domain에서 실제 월말로 자동 보정됩니다.
- reading mutation body는 `measuredAtMs`와 decimal `cumulativeKwh`만 받고 기존 usage domain을 통해 정수 Wh로 정규화합니다.
- 같은 meter의 exact measured instant 중복과 직전/다음 reading 기준 누적값 역행은 409로 거부합니다. 동일 누적값은 0 Wh 구간으로 허용하는 기존 domain 계약을 유지합니다.
- 파생 usage/daily/billing/forecast 값은 mutation API에서 DB에 중복 저장하지 않습니다.

이 API 필드명은 현재 전기 runtime 기준이다. gas 지원 WorkUnit에서는 meter의 immutable utility kind가 단위 owner가 되도록 neutral raw reading contract로 frontend/Worker를 함께 migration한다.

## 최소 frontend 결정

| 후보 | 현재 요구와의 판단 |
| --- | --- |
| Plain HTML/CSS/JavaScript | 빌드 의존성이 없어 가장 간단하나, 순수 계산 입력·결과와 API 계약의 타입 검사가 없어 유지 비용이 늘어날 수 있음 |
| **Vite + TypeScript + 기본 DOM/CSS** | 채택. 화면 4개를 위한 런타임 프레임워크 없이 타입 검사, 모듈, 로컬 서버, 정적 build를 확보 |
| React / Next.js / Vue / Svelte 등 | 보류. 현재는 복잡한 반응형 상태, SSR, 서버 라우팅 요구가 없어서 추가 런타임·도구 체계의 이점이 작음 |

직접 개발 의존성은 Vite, TypeScript, Playwright 세 개이며 앱의 런타임 package dependency는 없습니다. Google ID token/session crypto도 Web Crypto를 사용해 새 runtime auth dependency를 추가하지 않았습니다. frontend 로그인 UI는 실제 client ID가 있는 signed-out 상태에서 Google GIS 공식 script를 로드하지만 외부 폰트·아이콘·차트 라이브러리는 사용하지 않습니다. domain/Worker API 테스트는 Node 내장 test runner를 사용하고 persistence migration 검증은 Python 표준 `sqlite3`만 사용합니다. Local runtime CI는 앱 dependency로 Wrangler를 추가하지 않고 검증 스크립트에서 `wrangler@4.129.0`을 명시적으로 고정해 실행합니다.

## 책임 경계

| Owner | 현재 / 향후 책임 |
| --- | --- |
| `src/main.ts`, `src/style.css`, `src/live.css` | auth 상태, 현재 화면 렌더링, 빠른 입력, owner/viewer 표시, 실제 domain 결과와 meter 설정 UI. gas 구현 시 상위 utility switch와 utility별 단위 표시를 추가 |
| `src/api.ts` | frontend same-origin `/api` HTTP 경계. SQL/D1 binding을 알지 않음 |
| `src/demo.ts` | 이전 prototype SAMPLE fixture. live UI에서는 import하지 않으며 실제 domain/API 결과로 취급하지 않음 |
| `src/domain/usage.ts` | 현재 전기 runtime의 누적값 정규화, 절대 instant reading, 구간 사용량·경과시간·평균 소비전력. gas 확장 시 공통 counter primitive와 electricity-specific adapter 경계를 분리 |
| `src/domain/calendar.ts` | IANA timezone 기준 local-date 변환, 월 길이, local midnight instant 등 공용 calendar primitive |
| `src/domain/dailyUsage.ts` | 계량기 timezone 기준 날짜 경계 분할/보간, `actual / interpolated` provenance |
| `src/domain/billingCycle.ts` | 1~31일/월말 검침 설정, 실제 마감일 보정, 이전/현재/다음 주기, 경계 actual 우선/보간, 주기 사용량 |
| `src/domain/forecast.ts` | 최신 구간 pace, caller 지정 최근 완전 일자 평균, 현재 주기 평균, 마감 예상, 30일 환산, 이전 주기 비교, 객관 confidence evidence |
| `src/auth/google.ts` | Google GIS ID token signature/JWK/claims 검증. 공급자 `sub`만 identity 입력으로 반환 |
| `src/auth/session.ts` | 앱 session HMAC 서명/검증, `__Host-` cookie 생성·제거, TTL/secret 입력 검증 |
| `src/worker.ts` | 동일-origin Worker entry, auth와 `/api/meters*` route/method dispatch, request validation, server-side owner/viewer authorization. local probes는 명시적 local gate에서만 활성 |
| `src/persistence/d1.ts` | D1-compatible prepared read/write query, user/meter/access/reading persistence와 DB row 검증. UI/domain에서 SQL이나 binding을 직접 사용하지 않게 하는 persistence owner |
| `migrations/` | D1 schema/migration source. 현재는 users/meters/viewer grants/raw readings와 DB-level integrity/index 계약만 소유 |
| `wrangler.local.jsonc`, `persistence-tests/local_fixture.sql`, `persistence-tests/local_runtime_check.sh` | local D1/workerd integration evidence 전용. remote resource/config의 source가 아님 |
| `scripts/configure-canonical-d1.mjs`, `scripts/configure-auth-runtime.mjs` | 실제로 확인된 canonical remote identity/public auth vars만 root config에 기록하는 provisioning guard. Secret이나 remote mutation 자체를 소유하지 않음 |
| `src/domain/tariff.ts` | usage와 별도 전기 tariff policy 모듈. 정책 version/effective window, 공식 출처 provenance·확인일, 누진·계절·기본요금, 기후환경·연료비(window)·부가세·기금·최저요금·슈퍼유저요금, 반올림과 명시적 미반영 항목을 소유(`docs/TARIFF_POLICY.md`) |
| `docs/GAS_METER_DIRECTION.md` | 전기/가스 utility 확장의 제품 명칭, D1/API migration, 공통 counter/domain 경계, gas tariff/provider provenance와 구현 순서 계약 |

## 향후 production 방향

```text
Frontend / PWA
  → Cloudflare Workers Static Assets
  → 동일 origin의 Worker /api 경계
  → canonical D1
```

root `wrangler.jsonc`는 `./dist` Static Assets와 `src/worker.ts` module entry를 함께 배포하고 `/api/*`만 Worker-first로 라우팅합니다. 정적 asset 요청은 기본 asset-first 경로를 유지합니다. **canonical D1 database/binding/migration과 최종용 Google auth runtime이 구성됐고 dev preview에서 실제 Google Provider 로그인·first user/meter·reading 저장·재로그인 복원 E2E까지 검증됐습니다.** `wrangler.local.jsonc`는 local simulation 전용이며 canonical remote resource를 대체하지 않습니다. Workers Builds Git 연동과 non-production preview는 사용하지만 정식 production 릴리스는 아직 하지 않았습니다.

2026-09-08 Cloudflare 공식 문서 확인 기준 Workers Free는 Worker 실행 요청 100,000회/일, HTTP 요청당 CPU 10 ms이고 Static Assets 요청은 무료·무제한입니다. Static Assets는 Free에서 Worker version당 20,000 files, 개별 파일 25 MiB 제한입니다.

같은 날 다시 확인한 D1 Workers Free 기준은 **5,000,000 rows read/day, 100,000 rows written/day, 계정 총 5 GB, database당 500 MB, account당 10 databases, Worker invocation당 최대 50 D1 queries**입니다. Free의 일일 read/write 또는 storage 한도에 도달하면 D1 query가 실패하며 자동 유료 과금으로 전환되지 않습니다. D1 data egress 요금은 없습니다. index도 storage/write를 사용하므로 실제 access path에 필요한 최소 index만 유지합니다.

D1 local development는 Wrangler의 local simulation을 사용하며 remote data와 기본적으로 분리됩니다. D1 prepared statement에는 bound parameter 사용이 권장됩니다. 실제 제품 dependency 근거는 Cloudflare 공식 문서를 사용하며 이번 확인 기준일은 `2026-09-08`입니다.

- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/sql-api/foreign-keys/
- https://developers.cloudflare.com/d1/reference/migrations/
- https://developers.cloudflare.com/d1/best-practices/local-development/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/

검침 의미: 21일 마감의 표시 기간은 전월 22일~당월 21일입니다. 설정은 1~31일 또는 별도 월말을 지원하며, 고정 일자가 없는 달에는 해당 월 마지막 날을 실제 마감일로 사용합니다. 경계값은 실제 경계 기록 → 전후 기록 보간 → 자료 부족 시 미산출 순서입니다. 최근 구간 소비 속도, 최근 일평균, 주기 평균, 마감 예상, 30일 환산은 서로 다른 값으로 유지합니다.

현재 없는 주요 기능: 실제 `전기 / 가스` runtime과 gas tariff/provider policy, 실제 owner/viewer 공유 초대·해제 관리 UI/API, 복지할인 자격 기반 optional policy, production service worker·push·background sync·정식 production 배포.

## Public 저장소

실제 계량기 기록, 개인정보, 로그, DB dump, 쿠키, token, secret, 실제 `.env`/`.dev.vars`를 포함하지 않습니다. `persistence-tests/local_fixture.sql`은 synthetic fixture만 포함합니다. 의존성 출처·버전·integrity는 `package-lock.json`에 보존합니다. `AGENTS.md`의 작업/Git/보안 규칙을 따릅니다.
