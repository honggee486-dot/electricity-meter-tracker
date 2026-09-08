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

실제 database가 생성된 뒤 root `wrangler.jsonc`에는 다음 형태의 binding만 둡니다.

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

`database_id`는 Secret은 아니지만 placeholder/fake UUID를 commit하지 않습니다. Root binding에는 `preview_database_id`를 추가하지 않습니다.

Remote schema는 `migrations/`의 versioned migration으로만 적용합니다. `persistence-tests/local_fixture.sql`과 synthetic user/meter/reading은 canonical remote D1에 넣지 않습니다. 실제 user data가 생긴 뒤에는 개발 편의를 위해 canonical D1을 초기화하거나 fixture로 덮어쓰지 않습니다.

## Repository preflight guard

`wrangler.jsonc`가 아직 실제 D1과 연결되지 않은 동안에는 `CANONICAL_D1_BINDING_PLACEHOLDER` marker를 유지합니다. 실제 UUID가 Cloudflare에서 확인된 뒤에만 다음 helper로 binding을 기록합니다.

```sh
node scripts/configure-canonical-d1.mjs --write <실제 Cloudflare D1 UUID>
```

이 helper는 remote resource를 생성하거나 migration을 실행하지 않습니다. 저장소의 exact config mutation만 담당하며 다음을 강제합니다.

- 실제 UUID 형식이 아니면 실패
- canonical database name `electricity-meter-tracker` / binding `DB` / migrations dir `migrations`만 허용
- root `preview_database_id` 금지
- 이미 같은 UUID로 설정된 경우 idempotent no-op
- 다른 UUID 또는 다른 database name으로 이미 설정되어 있으면 자동 교체하지 않고 실패

`npm run test:provisioning`은 root config가 marker 상태 또는 정확한 canonical binding 상태인지, local D1 config가 synthetic runtime으로 계속 분리되어 있는지, `.env.example`이 실제 값을 포함하지 않는지를 검증합니다. GitHub Actions에서도 항상 실행합니다.

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
2. `wrangler d1 list --json`으로 같은 이름의 existing resource 확인.
3. 없을 때만 canonical D1을 `apac` location hint로 한 번 생성. 자동 config update는 끄고 실제 UUID를 다시 확인합니다.
4. 실제 database ID를 확인한 뒤 `node scripts/configure-canonical-d1.mjs --write <UUID>`로 root `DB` binding을 기록하고 diff를 검사.
5. canonical D1에 versioned migration 적용 및 migration 상태 확인.
6. 기존 build/provisioning/domain/Worker/local-D1 regression 재실행.
7. Google Web Client 생성 및 dev origin 등록.
8. Client ID, signing secret, 명시적으로 결정한 TTL을 runtime configuration에 주입.
9. 실제 Google login → first user → first meter → reading 저장 → reload 복원 E2E 확인.

Cloudflare의 current Wrangler CLI에서 `d1 create`는 remote D1을 생성하며 `--location`, `--binding`, `--update-config`를 지원합니다. 이 저장소에서는 Wrangler의 자동 config mutation보다 위 helper를 사용해 실제 UUID가 확인된 뒤 root config를 명시적으로 갱신합니다. Remote migration은 `wrangler d1 migrations apply electricity-meter-tracker --remote` 의미를 사용하며 실제 실행 시 현재 pinned Wrangler help를 다시 확인합니다.

## 금지

- canonical remote D1에 synthetic fixture 적용
- Secret, cookie, ID token, 실제 user row/reading을 repository 또는 검증 log에 기록
- fake D1 UUID나 fake Google Client ID commit
- canonical DB identity mismatch를 helper로 자동 덮어쓰기
- 사용자 승인 없는 `main` 통합, VERSION/tag/Release, production deploy
- 실제 data가 있는 canonical D1의 개발 편의 초기화
