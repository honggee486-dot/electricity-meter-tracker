# NEXT_WORK.md

## 현재 완료: architecture / mobile preview / 순수 domain + Worker API + D1 persistence/runtime + Google identity/session baseline

- [x] Vite + TypeScript + 기본 DOM/CSS 선택, 런타임 프레임워크 없음
- [x] Workers Static Assets 개발 preview 및 `work/*` 자동 preview 경로 확인
- [x] UI / usage / tariff / API / auth / persistence 최소 책임 경계 정리
- [x] 홈 즉시 입력, 자동 시각과 임시 체험 기록, 기록/분석/설정/공유 준비 UI
- [x] 누적 kWh 문자열 → 정확한 정수 Wh 변환, 절대 epoch-millisecond reading 계약
- [x] 구간 사용량·경과시간·평균 소비전력, 일자별 분할/보간과 `actual / interpolated` provenance
- [x] 검침 마감 `1~31일 + 월말`, 월말 자동 보정, 이전/현재/다음 검침주기와 경계 보간
- [x] 최근 구간/최근 완전 일자/주기 평균, 마감 예상, 30일 환산, 이전 주기 비교와 confidence evidence
- [x] 월말/연말/윤년/DST 및 UTC / Asia-Seoul process timezone 자동 검증
- [x] 동일-origin Worker module entry + `/api/health` + JSON API error baseline
- [x] `users / meters / meter_members / readings` D1 schema/migration과 최소 index/FK/cascade 계약
- [x] Google subject / 내부 user ID / owner meter / viewer meter / ordered reading D1 persistence owner
- [x] first-login `INSERT OR IGNORE` + 재조회로 Google subject → 내부 user 자동 생성과 동시성 winner 재사용
- [x] local-only Wrangler D1 migration/fixture/workerd HTTP round trip 및 product-config dev probe isolation
- [x] Google GIS ID token RS256/JWK 서명 + issuer/audience/expiry/subject 검증
- [x] GIS `g_csrf_token` cookie/body double-submit 검증과 form body/content-type 제한
- [x] `__Host-em_session` HMAC-SHA256 서명 세션, `Secure; HttpOnly; SameSite=Lax`, env 기반 TTL/secret 검증
- [x] `/api/auth/config`, `/api/auth/google`, `/api/auth/session`, `/api/auth/logout` 서버 auth baseline
- [x] local workerd에서 synthetic first-login D1 write/read + session sign/verify round trip
- [x] `.dev.vars` / `.env` 계열 Secret 파일 Git 제외
- [x] build + persistence + local D1/workerd + Worker/auth + domain + Playwright GitHub Actions verify

UI는 아직 `src/demo.ts`의 고정 SAMPLE / DEMO DATA를 사용하며 실제 domain/API/D1/auth 결과와 연결하지 않습니다. 실제 Cloudflare remote D1 database/binding, Google Client ID/SESSION_SECRET 설정, 실제 Google Provider 로그인, meter/readings mutation CRUD도 아직 없습니다.

## 완료 WorkUnit: Google 로그인 + 내부 identity/session baseline

현재 baseline:

1. Google 로그인은 Google Identity Services가 POST하는 `credential` ID token을 서버에서 검증하는 경로를 사용하며 Google API access token/refresh token을 저장하지 않는다.
2. `src/auth/google.ts`는 Google JWK를 HTTPS로 조회·Cache-Control에 따라 캐시하고 `kid` 변경 시 한 번 refresh한다. RS256 signature, `iss`, `aud`, multi-audience `azp`, `exp`, optional `nbf`, `sub`를 검증한다.
3. 사용자 identity는 Google `sub`가 canonical provider identifier이고 email은 불변 identity key로 사용하지 않는다.
4. 최초 정상 로그인은 UUID 후보 내부 `user_id`를 만들고 `INSERT OR IGNORE` 후 Google subject를 재조회한다. 이미 존재하거나 동시 삽입된 subject는 저장된 내부 user를 재사용한다.
5. `/api/auth/google`은 `application/x-www-form-urlencoded`만 받고 Google GIS의 `g_csrf_token` cookie/body double-submit 일치를 강제하며 중복/누락 credential 또는 CSRF 값을 거부한다.
6. 앱 session은 브라우저 JavaScript가 읽을 필요가 없는 `__Host-em_session` cookie이며 Web Crypto HMAC-SHA256으로 서명한다. cookie는 `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`이고 Domain을 설정하지 않는다.
7. `SESSION_SECRET`은 최소 32 UTF-8 bytes, `SESSION_TTL_SECONDS`는 60초~31일 범위의 환경 설정이며 저장소에 실제 값을 두지 않는다. `.dev.vars`와 `.env` actual secret 파일은 Git에서 제외한다.
8. `/api/auth/session`은 서명·만료를 검증한 내부 user가 D1에 실제 존재할 때만 인증 성공을 반환한다. 잘못된 session은 결정적으로 401이고 유효하지 않은 cookie는 정리한다.
9. unit test는 실제 Web Crypto RSA keypair로 Google JWT signature/claim failure, JWK cache/rotation, session tamper/expiry, CSRF, first/returning login, persistence parameter binding을 보호한다.
10. local Wrangler/workerd harness는 synthetic subject의 first-login D1 write/read와 HMAC session round trip을 수행하며 root product config에서 `/api/_dev/persistence-check`와 `/api/_dev/auth-check`가 모두 404인지 확인한다.
11. 실제 Google credential, production secret, remote D1 binding, 실제 사용자 데이터, 로그인 UI, production deploy는 추가하지 않았다.

## 다음 1순위 WorkUnit: server-side ownership/authorization + meter/readings CRUD

현재 auth session과 D1 owner/viewer 구조 위에 최소 meter/readings API를 추가하되 UI 전체 연결이나 복잡한 공유 관리는 한 번에 묶지 않습니다.

완료 조건:

1. 모든 meter/readings product route는 먼저 유효한 내부 session user를 요구하고 frontend 표시 여부에 의존하지 않는다.
2. owner는 자기 meter 조회·설정 수정·reading 조회/생성/수정/삭제를 할 수 있고, 다른 사용자의 meter ID를 직접 넣은 요청은 데이터가 새지 않게 결정적으로 거부한다.
3. 명시적 `meter_members` viewer는 공유된 meter/readings 조회만 허용하고 mutation·설정 변경·공유 관리 권한은 갖지 않는다.
4. 공유받지 않은 사용자는 다른 meter와 reading을 직접 조회하거나 변조할 수 없다.
5. request body/path parameter를 서버에서 검증하고 cumulative Wh 역행, 동일 measured instant 중복, 잘못된 timezone/검침 설정을 기존 domain/DB 계약과 정합되게 거부한다.
6. mutation은 필요한 최소 D1 query owner에만 추가하고 UI/domain에 SQL을 퍼뜨리지 않는다. 파생 계산값은 DB에 저장하지 않는다.
7. owner/viewer/비회원 접근과 client-side owner ID 변조, 공유 해제 후 접근 차단을 자동 테스트한다.
8. 실제 remote D1 resource, 실제 사용자 데이터, sharing invitation UI, production deploy는 사용자 승인 없이 추가하지 않는다.
9. 403/404 같은 외부 denial 표현이 실제 정보노출/UX 계약을 갈라놓고 현재 저장소 근거로 우열을 정할 수 없을 때만 구현 전에 Discussion Gate를 연다.

## 그 이후 후보

- 실제 모바일 UI와 auth/API/domain 연결
- 검침 마감 설정 UI: 1~31일 + 월말 선택
- PWA installability; offline write/background sync는 별도 필요 확인 전 보류
- version/effective date를 갖는 독립 전기요금 policy
- 실제 owner/viewer 공유 UI/관리

VERSION/tag/release/main 통합/정식 production 배포는 사용자 승인 없이 진행하지 않습니다.
