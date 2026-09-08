# electricity-meter-tracker

전기 계량기 누적값을 임의 시점에 빠르게 기록하는 모바일 중심 웹앱.

## 현재 상태

**Architecture baseline + mobile UI prototype + 순수 사용량 구간 domain** 단계입니다. UI의 초기 기록과 지표는 여전히 가상 SAMPLE / DEMO DATA이며 실제 저장·계산 결과와 연결되지 않았습니다.

- 홈 진입 → 현재 계량기 숫자 입력 → 기록하기. 별도 페이지나 모달이 필요하지 않습니다.
- 빈 값과 숫자 형식이 아닌 입력은 버튼 비활성화. UI는 소수점을 포함한 15자 이내 입력을 받지만 이 제한은 production 계량값 계약이 아닙니다.
- 체험 기록에는 현재 시각을 자동으로 붙여 기록 탭에 표시합니다. 메모리에만 존재하며 새로고침하면 사라집니다. localStorage, DB, 네트워크 저장은 없습니다.
- 홈 / 기록 / 분석 / 설정 하단 탐색, 읽기 전용 계량기 설정, 준비 중인 공유 UI.
- 구간 사용량·소비전력, 최근 일평균, 검침주기 평균, 마감 예상, 비교용 30일 환산을 분리해 표시합니다. 현재 UI 지표는 입력해도 바뀌지 않는 고정 샘플입니다.
- 일별 경계 측정 / 추정·보간의 구분은 표현 예시입니다. 보간 엔진과 실제 한전 요금표는 없으며 **예상 전기요금도 고정 샘플**입니다.
- `src/domain/usage.ts`에는 DOM·Worker·DB와 독립적인 첫 실제 계산 계약이 있습니다. 누적값을 정수 Wh로 정규화하고 두 기록의 사용량·경과시간·평균 소비전력을 계산합니다.
- 개발용 정적 preview는 Cloudflare Workers Builds와 연결되어 있습니다. `main`은 production 기준, `work/*`는 non-production preview이며 고정 개발 주소는 `https://dev-electricity-meter-tracker.247dev.workers.dev`입니다. Dashboard 설정은 저장소 밖 상태이므로 문제 조사 시 실제 Cloudflare 설정을 다시 확인합니다.

## 실행과 검증

Node.js `^20.19.0 || >=22.12.0`, npm을 사용합니다. lockfile을 커밋해 개발 의존성을 고정합니다.

```sh
npm ci
npm run dev
```

출력된 로컬 주소를 엽니다. 개발 서버는 기본 `127.0.0.1:5173`이며 외부로 공개하지 않습니다.

```sh
npm run build
npm run test:domain
npx playwright install chromium webkit
npm run test:ui
```

- `npm run typecheck`: strict TypeScript 검사. Vite 변환과 별도로 실행합니다.
- `npm run build`: 타입 검사 후 `dist/` 정적 산출물 생성.
- `npm run test:domain`: `src/domain`만 `.domain-test/`에 임시 컴파일한 뒤 Node 내장 test runner로 순수 domain 테스트를 실행합니다. `.domain-test/`는 커밋하지 않습니다.
- `npm run test:ui`: 이미 빌드된 `dist/`를 포트 4173 preview 서버로 열어 Playwright 브라우저 검증을 실행합니다. 소스 변경 후에는 먼저 build가 필요합니다.
- `npm test`: domain 테스트와 UI 테스트를 순서대로 실행합니다. UI 테스트 전에는 `npm run build`가 선행되어야 합니다.
- Playwright는 iPhone 13 프로필의 Chromium/WebKit과 1440×900 데스크톱 Chromium에서 실행합니다. 긴 숫자는 390px 및 320px에서도 검사합니다.
- `.github/workflows/verify.yml`은 `main`, `work/**`, pull request에서 build, UTC/Asia-Seoul domain 테스트, Chromium/WebKit UI 테스트를 검증합니다.
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
- 계량기 timezone은 다음 날짜 경계·검침주기 WorkUnit에서 calendar projection에 사용합니다. 순수 구간 계산에는 필요하지 않습니다.

## 최소 frontend 결정

| 후보 | 현재 요구와의 판단 |
| --- | --- |
| Plain HTML/CSS/JavaScript | 빌드 의존성이 없어 가장 간단하나, 향후 순수 계산 입력·결과와 API 계약의 타입 검사가 없어 유지 비용이 늘어날 수 있음 |
| **Vite + TypeScript + 기본 DOM/CSS** | 채택. 화면 4개를 위한 런타임 프레임워크 없이 타입 검사, 모듈, 로컬 서버, 정적 build를 확보 |
| React / Next.js / Vue / Svelte 등 | 보류. 현재는 복잡한 반응형 상태, SSR, 서버 라우팅 요구가 없어서 추가 런타임·도구 체계의 이점이 작음 |

직접 개발 의존성은 Vite, TypeScript, Playwright 세 개이며 앱의 런타임 의존성은 없습니다. domain 테스트는 Node 내장 test runner를 사용해 새 test dependency를 추가하지 않습니다. 외부 폰트·아이콘·차트 라이브러리·CDN을 사용하지 않습니다.

## 책임 경계

| Owner | 현재 / 향후 책임 |
| --- | --- |
| `src/main.ts`, `src/style.css` | 현재 화면 렌더링, 입력 형식, 탐색, 임시 체험 기록. 향후 UI는 domain 결과와 API 응답을 표현 |
| `src/demo.ts` | 현재 모든 가상 초기 기록·지표·계량기 설정의 단일 원본. 실제 domain 결과로 취급하지 않음 |
| `src/domain/usage.ts` | DOM, Worker, DB에 의존하지 않는 누적값 정규화, 절대 instant reading, 구간 사용량·경과시간·평균 소비전력. 날짜/검침 경계는 아직 소유하지 않음 |
| 향후 usage calendar domain | 계량기 timezone 기준 날짜 경계 분할/보간, 검침 경계, 검침주기, 예측 |
| 향후 tariff policy | usage와 별도 모듈. 정책 version/effective date, 누진·계절·기본요금·조정요금·세금·기금·반올림을 소유 |
| 향후 Worker API | 인증된 요청과 입력 검증, 사용자별 접근 권한, domain 호출. UI가 권한의 근거가 되지 않음 |
| 향후 persistence | D1 쿼리 및 저장만 담당. UI/domain에서 SQL이나 Cloudflare binding을 직접 사용하지 않음 |
| 향후 auth | Google 공급자의 안정적 subject identifier와 내부 user_id 연결. 이메일은 불변 identity가 아님. 서버에서 세션 검증 |

## 향후 production 방향

```text
Frontend / 향후 PWA
  → Cloudflare Workers Static Assets
  → 동일 origin의 Worker /api 경계
  → D1
```

현재 `wrangler.jsonc`에는 `./dist` 정적 assets와 workers.dev/preview URL 설정만 있습니다. Worker API, D1 binding, Google OAuth, Cloudflare Vite plugin은 없습니다. Workers Builds Git 연동과 non-production preview는 확인됐지만 정식 production 릴리스는 아직 하지 않았습니다.

운영비 0원 우선으로 Workers Free 및 D1 무료 할당량 내 운영을 목표로 합니다. 실제 Worker API/D1 도입 시점에는 현재 공식 가격·무료 한도를 다시 확인합니다.

데이터 구조는 `users`, `meters`, `readings`, `meter_members`를 후보로 둡니다. 사용자 한 명이 여러 계량기를 소유하고 각 계량기가 timezone과 마감일을 갖습니다. 공유는 owner/viewer를 기본 후보로 하고 API에서 자기 계량기 또는 명시적으로 공유된 계량기에만 접근을 허용합니다. 테이블·키·인덱스·migration은 데이터 설계 단계에서 정합니다.

향후 검침 의미: 21일 마감의 표시 기간은 전월 22일~당월 21일. 경계값은 실제 경계 기록 → 전후 기록 보간 → 자료 부족 추정 표시 순서입니다. 29~31일이 없는 달의 정책은 미정입니다. 최근 구간 소비 속도, 최근 일평균, 주기 평균, 마감 예상, 30일 환산은 서로 다른 값으로 유지합니다.

이번 단계에 없는 기능: UI와 실제 domain 연결, 날짜 보간, 검침주기/예측/요금 계산, Google OAuth·사용자 생성·세션, Worker API, D1·migration·영속 저장, 실제 공유 권한, production service worker·push·background sync·정식 production 배포.

## Public 저장소

실제 계량기 기록, 개인정보, 로그, DB dump, 쿠키, token, secret, 실제 `.env`를 포함하지 않습니다. 의존성 출처·버전·integrity는 `package-lock.json`에 보존합니다. `AGENTS.md`의 작업/Git/보안 규칙을 따릅니다.
