# Canonical remote resource provisioning

이 저장소는 preview에서 버리고 다시 만드는 별도 remote database를 사용하지 않습니다. 처음 만든 remote resource를 최종 운영본까지 이어서 사용합니다.

## Cloudflare D1

Canonical resource:

- database name: `electricity-meter-tracker`
- Worker binding: `DB`
- initial location hint: `apac`
- jurisdiction restriction: 없음
- current dev origin과 향후 production origin이 같은 canonical D1을 사용

생성 전에는 반드시 같은 이름의 기존 database가 있는지 확인합니다. 기존 resource가 있다면 중복 생성하지 않고 이 프로젝트용인지 확인합니다.

실제 database가 생성된 뒤 root `wrangler.jsonc`에 다음 형태로 기록합니다.

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

`database_id`는 Secret은 아니지만 placeholder/fake UUID를 commit하지 않습니다.

Remote schema는 `migrations/`의 versioned migration으로만 적용합니다. `persistence-tests/local_fixture.sql`과 synthetic user/meter/reading은 canonical remote D1에 넣지 않습니다. 실제 user data가 생긴 뒤에는 개발 편의를 위해 canonical D1을 초기화하거나 fixture로 덮어쓰지 않습니다.

## Google Web Client

Google Identity Services용 Web application Client도 최종용 하나를 사용합니다.

현재 Authorized JavaScript origin:

```text
https://dev-electricity-meter-tracker.247dev.workers.dev
```

향후 production origin이 확정되면 같은 client에 해당 origin을 추가합니다. 현재 frontend는 JavaScript callback 방식이므로 repository baseline에서는 redirect URI를 요구하지 않습니다.

권장 display name은 `electricity-meter-tracker-web`입니다. 실제 identity는 Google이 발급한 Client ID입니다.

## Runtime configuration

- `DB`: root `wrangler.jsonc`에서 canonical D1에 연결하는 binding
- `GOOGLE_CLIENT_ID`: 실제 Google Web Client ID. Secret은 아니지만 발급 전 임의값을 넣지 않음
- `SESSION_SECRET`: 최소 32 bytes의 강한 signing secret. repository에 commit하지 않고 Cloudflare secret으로만 저장
- `SESSION_TTL_SECONDS`: 명시적으로 결정한 session lifetime. 제품/security policy 값이므로 임의 기본값을 repository에 고정하지 않음

`.env.example`은 변수 이름과 용도 확인용일 뿐 실제 runtime value 저장소가 아닙니다.

## Provisioning 순서

1. Cloudflare 인증 상태 확인.
2. `wrangler d1 list`로 같은 이름의 existing resource 확인.
3. 없을 때만 canonical D1을 `apac` location hint로 한 번 생성.
4. 실제 database ID를 root `wrangler.jsonc`의 `DB` binding에 기록.
5. canonical D1에 versioned migration 적용 및 migration 상태 확인.
6. 기존 build/domain/Worker/local-D1 regression 재실행.
7. Google Web Client 생성 및 dev origin 등록.
8. Client ID, signing secret, 명시적으로 결정한 TTL을 runtime configuration에 주입.
9. 실제 Google login → first user → first meter → reading 저장 → reload 복원 E2E 확인.

## 금지

- canonical remote D1에 synthetic fixture 적용
- Secret, cookie, ID token, 실제 user row/reading을 repository 또는 검증 log에 기록
- fake D1 UUID나 fake Google Client ID commit
- 사용자 승인 없는 `main` 통합, VERSION/tag/Release, production deploy
- 실제 data가 있는 canonical D1의 개발 편의 초기화
