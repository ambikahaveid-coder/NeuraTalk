# Security Audit — Committed Secrets

Date: 2026-07-18
Scope: Phase 5 of the repository cleanup. Read-only investigation of what secret-shaped
files are (or ever were) tracked by git, run via `git ls-files` and `git log --all` across
the full history — no history rewrite was performed or is needed.

## 1. Headline finding

**Zero secrets have ever been committed to this repository.** Every secret-shaped file
present on disk (signing keystores, Firebase service account, `.env` files, Android
`key.properties`) shows **0 commits in `git log --all`** — they were kept out of git from
the start via `.gitignore`, not scrubbed after the fact.

## 2. File-by-file findings

| File | On disk? | Tracked? | Ever committed (`git log --all`)? | Verdict |
|---|---|---|---|---|
| `neuratalk-release-key.jks` (repo root) | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY. **Orphaned duplicate** — no build/CI/gradle config references this copy (confirmed via repo-wide grep). The copy Gradle actually signs with is `flutter_app/neuratalk-release-key.jks` via `flutter_app/android/key.properties:4` (`storeFile=../neuratalk-release-key.jks`). |
| `flutter_app/neuratalk-release-key.jks` | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY, **this is the live signing key** — referenced by `flutter_app/android/key.properties`. |
| `flutter_app/android/neuratalk-release-key.jks` | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY, third copy, covered by `flutter_app/android/.gitignore:14`. |
| `server/firebase-service-account.json` | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY (real credentials). |
| `server/firebase-service-account.json.example` | Yes | Yes | — | TRACKED-BUT-EXAMPLE — intended placeholder template. |
| `.env` (root) | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY, actively ignored via `.gitignore:18`. |
| `server/.env` | Yes | No | 0 commits | UNTRACKED-ON-DISK-ONLY. |
| `.env.example`, `server/.env.example`, `infra/docker/.env.example` | Yes | Yes | — | TRACKED-BUT-EXAMPLE — templates only. |
| `flutter_app/android/key.properties` | Yes | No | not checked (pattern-matched ignore) | UNTRACKED-ON-DISK-ONLY, covered by both root and `flutter_app/android/.gitignore`. |
| `*.pem`, `*.keystore`, `*.p12` (anywhere) | — | — | — | NOT FOUND. |
| Other `*secret*`/`*credential*`-named files | — | — | — | NOT FOUND. |

## 3. `.gitignore` coverage

Confirmed comprehensive and correct **before** this cleanup began — no gaps found in secret
patterns:

```
.env / .env.* (with !.env.example)
*.jks / *.keystore / key.properties
*service-account*.json (with !*.example.json)
*credentials*.json (with !*.example.json)
*.pem / *.key (with !*.pub.key)
firebase-adminsdk-*.json
neuratalk-release-key.jks
```

Plus a nested `flutter_app/android/.gitignore` independently ignoring `key.properties` and
`**/*.jks`. This cleanup's `.gitignore` changes (see `REPOSITORY_CLEANUP_REPORT.md`) only
added *non-secret* build-noise patterns (`coverage/`, `test-results/`, flutter build `.txt`
logs) — no changes were needed on the secrets side.

## 4. Recommended manual action (not performed automatically)

The root-level `neuratalk-release-key.jks` is an unreferenced duplicate of a release-signing
key. It was **not** deleted or moved as part of this automated cleanup — deleting a signing
key is irreversible in effect (if it's ever the *only* copy of a key that matches your Play
Store listing, losing it blocks all future app updates), and this task's rules require every
action to be reversible and no deletion without proof of non-use. Proof of non-use is
established (§2), but the blast radius of being wrong is too high for an unattended delete.

**Recommended**: verify this root copy is identical to `flutter_app/neuratalk-release-key.jks`
(e.g. `diff` or checksum both), and if so, delete the root copy yourself, or move it to a
secrets manager / offline backup outside the repository.

## 5. Conclusion

No history-scrubbing tools (`git filter-repo`, BFG) are needed. The security posture here is
already sound; this audit exists to document that fact with evidence, not to fix anything.
