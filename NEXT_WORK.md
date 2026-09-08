# NEXT_WORK.md

## 현재 완료: architecture / domain / Worker+D1 / Google session / authorized CRUD / live mobile UI baseline / canonical remote D1 provisioning / PWA installability shell

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

현재 UI는 실제 repository API/domain 계약을 사용하며, canonical Cloudflare remote D1 및 Google Web Client / Cloudflare auth runtime이 연결되어 dev preview(`https://dev-electricity-meter-tracker.247dev.workers.dev`)에서 실제 로그인과 데이터 복원이 검증되었습니다. PWA는 설치 가능한 app shell 계약까지만 포함하며 service worker, offline cache, offline write queue, Background Sync는 아직 추가하지 않습니다. repository 자동화 테스트에서는 deterministic mock과 local D1/workerd를 사용합니다.

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
9. 전기요금은 아직 정책 모듈이 없으므로 실제/샘플 금액을 표시하지 않습니다.
10. Playwright는 API와 GIS를 deterministic하게 mock해 auth 미설정/signed-out 로그인, owner quick write+reload, viewer read-only, 첫 meter 생성, API 실패, 월말 설정, 모바일 폭과 keyboard 흐름을 보호합니다.
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

## 다음 1순위 후보

- Google credential 검증 실패의 상세 runtime 진단은 server log에만 남기고 public API/UI에는 일반화된 오류만 노출하도록 auth error boundary hardening
- version/effective date와 공식 출처 provenance를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 초대/해제 UI와 관리 API

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
