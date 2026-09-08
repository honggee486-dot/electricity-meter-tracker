# Canonical remote resource provisioning

이 저장소는 preview에서 버리고 다시 만드는 별도 remote database를 사용하지 않습니다. 처음 만든 remote resource를 최종 운영본까지 이어서 사용합니다.

## Cloudflare D1

Canonical resource:

- database name: `electricity-meter-tracker`
- Worker binding: `DB`
- initial location hint: `apac`
- jurisdiction restriction: 없음
- current dev origin과 향후 production origin이 같은 canonical D1을 사용

현재 canonical D1은 실제 Cloudflare 계정에 생성되어 root `wrangler.jsonc`의 `DB` binding에 연결되어 있습니다. `migrations/0001_initial.sql`도 remote migration으로 적용했으며 canonical remote D1에는 synthetic fixture를 넣지 않았습니다.

Root binding은 다음 의미를 유지합니다.

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "electricity-meter-tracker",
    "database_id": "<실제 Cloudflare D1 UUID>",
    "migrations_dir": "migrations"
  }
]
```

`database_id`는 Secret은 아니지만 실제 Cloudflare에서 확인한 값만 사용합니다. Root binding에는 `preview_database_id`를 추가하지 않습니다.

Remote schema는 `migrations/`의 versioned migration으로만 적용합니다. `persistence-tests/local_fixture.sql`과 synthetic user/meter/reading은 canonical remote D1에 넣지 않습니다. 실제 user data가 생긴 뒤에는 개발 편의를 위해 canonical D1을 초기화하거나 fixture로 덮어쓰지 않습니다.

## Canonical D1 repository guard

`node scripts/configure-canonical-d1.mjs --write <실제 Cloudflare D1 UUID>`는 repository config mutation만 담당합니다.

- 실제 UUID 형식이 아니면 실패
- canonical database name `electricity-meter-tracker` / binding `DB` / migrations dir `migrations`만 허용
- root `preview_database_id` 금지
- 이미 같은 UUID로 설정된 경우 idempotent no-op
- 다른 UUID 또는 다른 database name으로 이미 설정되어 있으면 자동 교체하지 않고 실패

D1 resource 생성이나 remote migration은 이 helper가 수행하지 않습니다.

## Google Web Client

Google Identity Services용 Web application Client는 최종용 하나만 사용합니다.

현재 Authorized JavaScript origin:

```text
https://dev-electricity-meter-tracker.247dev.workers.dev
```

향후 production origin이 확정되면 같은 client에 해당 origin을 추가합니다. 현재 frontend는 JavaScript callback 방식이므로 repository baseline에서는 redirect URI를 요구하지 않습니다.

권장 display name은 `electricity-meter-tracker-web`입니다. 실제 identity는 Google이 발급한 Client ID입니다.

## Auth runtime repository guard

실제 Google Web Client와 session lifetime이 확정되기 전 root `wrangler.jsonc`에는 `AUTH_RUNTIME_VARS_PLACEHOLDER` marker를 유지합니다.

실제 Client ID와 사용자가 명시적으로 선택한 TTL이 확인된 뒤 다음 helper로 public runtime vars만 기록합니다.

```sh
node scripts/configure-auth-runtime.mjs --write <실제 Google Web Client ID> <TTL seconds>
```

이 helper는 다음을 강제합니다.

- Google Web Client ID 형식 검증
- `SESSION_TTL_SECONDS`는 Worker session contract와 동일하게 60초 이상 31일 이하만 허용
- TTL 기본값을 임의로 만들지 않음
- `GOOGLE_CLIENT_ID`와 `SESSION_TTL_SECONDS`만 root `vars`에 기록
- `SESSION_SECRET`을 `wrangler.jsonc`에 기록하지 않음
- 같은 Client ID/TTL이면 idempotent no-op
- 이미 다른 Client ID 또는 다른 TTL이 설정돼 있으면 자동 교체하지 않고 실패

실제 runtime 값을 shell/environment에 준비한 상태에서 다음 검증을 사용할 수 있습니다.

```sh
node scripts/configure-auth-runtime.mjs --check-env
```

이 검증은 `GOOGLE_CLIENT_ID`, `SESSION_TTL_SECONDS`, `SESSION_SECRET`의 존재와 형식만 확인하며 Secret 값을 출력하지 않습니다. `SESSION_SECRET`은 최소 32 bytes여야 합니다.

`npm run test:provisioning`은 canonical D1 binding, local D1 격리, auth runtime marker/public vars, Google Client ID/TTL/secret 경계, `.env.example` names-only 계약을 모두 검증합니다. GitHub Actions에서도 항상 실행합니다.

## Runtime configuration

- `DB`: root `wrangler.jsonc`의 canonical D1 binding
- `GOOGLE_CLIENT_ID`: 실제 최종용 Google Web Client ID. Secret은 아니지만 발급 전 임의값 금지
- `SESSION_TTL_SECONDS`: 명시적으로 선택한 session lifetime. 제품/security policy이므로 저장소가 기본값을 선택하지 않음
- `SESSION_SECRET`: 최소 32 bytes의 강한 signing secret. repository에 commit하지 않고 Cloudflare secret으로만 저장

`.env.example`은 변수 이름 확인용일 뿐 실제 runtime value 저장소가 아닙니다.

## 다음 provisioning 순서

D1 단계는 완료되었습니다. 다음 순서는 auth/provider runtime입니다.

1. 최종용 Google Web application Client를 생성하거나 기존 최종용 Client를 확인합니다.
2. `https://dev-electricity-meter-tracker.247dev.workers.dev`를 Authorized JavaScript origin으로 등록합니다.
3. session lifetime을 명시적으로 결정합니다. 저장소는 숨은 TTL 기본값을 선택하지 않습니다.
4. 실제 Client ID와 TTL을 `node scripts/configure-auth-runtime.mjs --write ...`로 root public vars에 기록하고 diff를 확인합니다.
5. 강한 `SESSION_SECRET`을 repository 밖 Cloudflare secret으로 주입합니다.
6. 현재 Cloudflare/Wrangler 방식으로 dev alias에 새 Worker version을 올립니다. production deploy는 하지 않습니다.
7. `/api/auth/config`이 실제 Client ID를 제공하고 `/api/auth/session`이 signed-out 상태에서는 401을 반환하는지 확인합니다.
8. 실제 Google login → first user 생성 → first meter 생성 → reading 저장 → reload 후 동일 raw reading/계산 복원까지 dev origin에서 검증합니다.
9. Secret, cookie, ID token, 실제 user row/reading을 commit하거나 검증 log에 노출하지 않습니다.

Google Cloud Console 로그인, OAuth client 생성, Cloudflare secret 입력처럼 credential/MFA가 필요한 단계는 사용자가 직접 인증만 완료하고 나머지 가능한 절차는 Agent가 수행합니다.

## 금지

- canonical remote D1에 synthetic fixture 적용
- Secret, cookie, ID token, 실제 user row/reading을 repository 또는 검증 log에 기록
- fake D1 UUID나 fake Google Client ID commit
- `SESSION_SECRET`을 root `vars`, `.env.example` 실제 값, 문서 예시 실제 값으로 기록
- canonical DB identity mismatch 또는 Google Client/TTL mismatch를 helper로 자동 덮어쓰기
- 사용자 승인 없는 `main` 통합, VERSION/tag/Release, production deploy
- 실제 data가 있는 canonical D1의 개발 편의 초기화
