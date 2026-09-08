# electricity-meter-tracker

전기 계량기 누적값을 임의 시점에 빠르게 기록하는 모바일 중심 웹앱.

## 현재 상태

**Architecture baseline + mobile UI prototype**. 모든 초기 기록과 지표는 가상 SAMPLE / DEMO DATA입니다. 실제 서비스나 계산 결과가 아닙니다.

- 홈 진입 → 현재 계량기 숫자 입력 → 기록하기. 별도 페이지나 모달이 필요하지 않습니다.
- 빈 값과 숫자 형식이 아닌 입력은 버튼 비활성화. 소수점을 포함한 15자 이내 입력을 받습니다. 이는 UI 데모 제한이며 실제 계량값 정밀도·최댓값 정책은 미정입니다.
- 체험 기록에는 현재 시각을 자동으로 붙여 기록 탭에 표시합니다. 메모리에만 존재하며 새로고침하면 사라집니다. localStorage, DB, 네트워크 저장은 없습니다.
- 홈 / 기록 / 분석 / 설정 하단 탐색, 읽기 전용 계량기 설정, 준비 중인 공유 UI.
- 구간 사용량·소비전력, 최근 일평균, 검침주기 평균, 마감 예상, 비교용 30일 환산을 분리해 표시합니다. 입력해도 이 지표는 바뀌지 않습니다.
- 일별 경계 측정 / 추정·보간의 구분은 표현 예시입니다. 보간 엔진과 실제 한전 요금표는 없으며 **예상 전기요금도 고정 샘플**입니다.

## 실행과 검증

Node.js `^20.19.0 || >=22.12.0`, npm을 사용합니다. lockfile을 커밋해 개발 의존성을 고정합니다.

```sh
npm ci
npm run dev
```

출력된 로컬 주소를 엽니다. 개발 서버는 기본 `127.0.0.1:5173`이며 외부로 공개하지 않습니다.

```sh
npm run build
npx playwright install chromium webkit
npm test
```

- `npm run typecheck`: strict TypeScript 검사. Vite 변환과 별도로 실행합니다.
- `npm run build`: 타입 검사 후 `dist/` 정적 산출물 생성.
- `npm test`: 이미 빌드된 `dist/`를 포트 4173 preview 서버로 열어 브라우저 검증. 소스 변경 후에는 먼저 build가 필요합니다.
- Playwright는 iPhone 13 프로필의 Chromium/WebKit과 1440×900 데스크톱 Chromium에서 실행합니다. 긴 숫자는 390px 및 320px에서도 검사합니다.
- 입력·버튼 상태·성공 안내·임시 기록·reload 초기화·탐색·키보드 포커스·가로 overflow·하단 메뉴 겹침·로컬 요청만 발생하는지 검사하며, `test-results/`에 화면 이미지를 남깁니다(커밋 제외).
- 모바일 프로필은 브라우저 에뮬레이션입니다. 실제 iPhone 키보드, Safari 도구막대, 홈 인디케이터의 safe-area 동작은 실기기 증거가 아닙니다. CSS에는 `viewport-fit=cover`와 상하좌우 `env(safe-area-inset-*)`를 반영했습니다.
- CI workflow는 아직 구성하지 않았습니다.

## 최소 frontend 결정

| 후보 | 현재 요구와의 판단 |
| --- | --- |
| Plain HTML/CSS/JavaScript | 빌드 의존성이 없어 가장 간단하나, 향후 순수 계산 입력·결과와 API 계약의 타입 검사가 없어 유지 비용이 늘어날 수 있음 |
| **Vite + TypeScript + 기본 DOM/CSS** | 채택. 화면 4개를 위한 런타임 프레임워크 없이 타입 검사, 모듈, 로컬 서버, 정적 build를 확보 |
| React / Next.js / Vue / Svelte 등 | 보류. 현재는 복잡한 반응형 상태, SSR, 서버 라우팅 요구가 없어서 추가 런타임·도구 체계의 이점이 작음 |

직접 개발 의존성은 Vite, TypeScript, Playwright 세 개이며 앱의 런타임 의존성은 없습니다. 외부 폰트·아이콘·차트 라이브러리·CDN을 사용하지 않습니다. 아이콘은 자체 인라인 SVG, 일별 막대는 CSS입니다. 정적 산출물은 호스팅 제공자와 독립적이므로 되돌릴 때 이전 build를 사용할 수 있습니다. 실제 배포·rollback 절차는 배포 단계에서 검증합니다.

Vite의 [vanilla-ts 지원](https://vite.dev/guide/)과 [별도 타입 검사 권고](https://vite.dev/guide/features)을 기준으로 선택했습니다.

## 책임 경계

현재 파일은 필요한 세 개의 UI 소스만 둡니다. 미래 계층을 위한 빈 서비스, 인터페이스, 폴더는 만들지 않습니다.

| Owner | 현재 / 향후 책임 |
| --- | --- |
| `src/main.ts`, `src/style.css` | 현재 화면 렌더링, 입력 형식, 탐색, 임시 체험 기록. 시간 표시는 meter timezone을 명시. 향후 UI는 domain 결과와 API 응답을 표현 |
| `src/demo.ts` | 현재 모든 가상 초기 기록·지표·계량기 설정의 단일 원본. 실제 domain 결과로 취급하지 않음 |
| 향후 usage domain | DOM, Worker, DB에 의존하지 않는 순수 TypeScript. 누적값 검증, 임의 시점 구간 사용량·시간·평균 소비전력, 날짜 경계/검침 경계 보간, 검침주기, 예측. Node 내장 test runner부터 검토 |
| 향후 tariff policy | usage와 별도 모듈. 정책 version/effective date, 누진·계절·기본요금·조정요금·세금·기금·반올림을 소유 |
| 향후 Worker API | 인증된 요청과 입력 검증, 사용자별 접근 권한, domain 호출. UI가 권한의 근거가 되지 않음 |
| 향후 persistence | D1 쿼리 및 저장만 담당. UI/domain에서 SQL이나 Cloudflare binding을 직접 사용하지 않음 |
| 향후 auth | Google 공급자의 안정적 subject identifier와 내부 user_id 연결. 이메일은 불변 identity가 아님. 서버에서 세션 검증 |

## 향후 production 방향 (미구현)

```text
Frontend / 향후 PWA
  → Cloudflare Workers Static Assets (정적 UI)
  → 동일 origin의 Worker /api 경계 (인증·권한)
  → D1 (저장)
```

Workers Static Assets를 우선 호스팅 후보로 정해 향후 정적 UI와 API를 같은 프로젝트에서 운영하도록 합니다. 이번에는 Worker 코드, Wrangler, Cloudflare Vite plugin, 계정 연결이나 배포 설정을 추가하지 않습니다. [Static Assets 공식 문서](https://developers.cloudflare.com/workers/static-assets/)를 확인했습니다.

운영비 0원 우선으로 Workers Free 및 D1 무료 할당량 내 운영을 목표로 합니다. 현재 무료 정적 요청과 별도로 Worker API 및 D1에는 사용 제한이 있으므로 무조건 무료 운영을 보장하지 않습니다. 실제 도입 시 [Workers 가격](https://developers.cloudflare.com/workers/platform/pricing/)과 [D1 가격/제한](https://developers.cloudflare.com/d1/platform/pricing/)을 재확인합니다. 현재는 운영 리소스를 만들지 않았습니다.

데이터 구조는 `users`, `meters`, `readings`, `meter_members`를 후보로 둡니다. 사용자 한 명이 여러 계량기를 소유하고 각 계량기가 timezone과 마감일을 갖습니다. 공유는 owner/viewer를 기본 후보로 하고 API에서 자기 계량기 또는 명시적으로 공유된 계량기에만 접근을 허용합니다. 테이블·키·인덱스·migration은 다음 데이터 설계 단계에서 정합니다.

향후 검침 의미: 21일 마감의 표시 기간은 전월 22일~당월 21일. 경계값은 실제 경계 기록 → 전후 기록 보간 → 자료 부족 추정 표시 순서입니다. 29~31일이 없는 달의 정책은 미정입니다. 최근 구간 소비 속도, 최근 일평균, 주기 평균, 마감 예상, 30일 환산은 서로 다른 값으로 유지합니다. 모든 시간 계산은 서버 로컬 시간에 의존하지 않고 계량기 timezone(기본 Asia/Seoul)을 사용하도록 설계합니다.

이번 단계에 없는 기능: 실제 사용량/예측/요금 계산, Google OAuth·사용자 생성·세션, API, D1·migration·영속 저장, 실제 공유 권한, production service worker·push·background sync·배포. Google 로그인만 지원하는 제품 방향은 유지하되 가짜 로그인 성공 UI는 두지 않았습니다.

## Public 저장소

실제 계량기 기록, 개인정보, 로그, DB dump, 쿠키, token, secret, 실제 `.env`를 포함하지 않습니다. 의존성 출처·버전·integrity는 `package-lock.json`에 보존합니다. `AGENTS.md`의 작업/Git/보안 규칙을 따릅니다.
