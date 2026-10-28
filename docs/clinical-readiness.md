# IRF rollout and validation

This application is an IRF scheduling and internal reference-assessment tool. It does not
submit IRF-PAI data or calculate CMS risk-adjusted quality measures. Existing patient minute
targets remain configurable planning targets, not automatic clinical prescriptions.

## Sources and rule boundaries

- IRF intensity expectations and documented exceptions: [CMS coverage guidance](https://www.cms.gov/training-education/medicare-learning-networkr-mln/compliance/medicare-provider-compliance-tips/inpatient-rehabilitation-hospitals).
- Coding and assessment windows: [CMS IRF-PAI manual](https://www.cms.gov/medicare/quality/inpatient-rehabilitation-facility/irf-pai-and-irf-qrp-manual), version 4.4 effective October 1, 2026. The app's 17-item reference set is not the full instrument. Exceptions, skip logic, and official submission validation belong in the approved clinical record.
- The admission/last-three-day window checks are internal reference checks. Legacy records without actual discharge dates remain unverified; do not substitute an estimated date or backfill an invented one.
- Minute-gap flags, severity labels, and staffing comparisons are operational review signals, not accreditation findings. The scoring-consistency minimum of ten observations is a local review floor, not a validated statistical test. Raw trends are unadjusted and exclude incomplete/unsigned/non-performance-coded pairs.
- SNF PDPM payment/benefit reminders do not run in this IRF deployment.

## Deploy without replacing existing clinical data

1. Take a consistent database backup and retain its recovery encryption key separately.
2. Verify a backup copy with `npm run backup:verify -- /path/to/backup.db` using the recovery key. Also test external file/object storage recovery separately.
3. Run `npm run check`, `npm test`, and client/server builds against a staging copy. Do not run the build script against the live database merely to test compilation: `npm run build` includes `db:push`.
4. Run `npm run db:upgrade:safety` to add the compatibility objects: `signInAttempts`, `aiChangeProposals`, nullable `patients.actualDischargeDate`, and nullable `invites.name`. The server also checks these on every dev/production startup before accepting requests. The upgrade is transactional and idempotent: it does not replace patient rows or reset locks. Other schema changes still use the normal reviewed `db:push`/managed-migration process. Do not rerun the manual SQL's `ALTER TABLE` after the column already exists.
5. Start the new server and verify sign-in, an existing schedule, a draft note, an assessment signature, and one AI review/apply/undo using test records. No existing target, schedule, or signed assessment is rewritten by this rollout.
6. Existing sessions are subject to the new 24-hour overall and one-hour inactivity limits. Actual user activity refreshes inactivity; background polling does not. Preserve unfinished work before leaving a shared device. Existing sign-in links remain supported.

## AI and outbound notifications

- Routine assignment and digest emails contain no patient names, room numbers, or clinical details. They link to the authenticated board.
- The default AI endpoint is localhost. A remote endpoint must use HTTPS, and every request to it goes through `server/aiPrivacy.ts`: patients become random per-request codes, names, room numbers, MRNs and calendar dates are removed (dates become "today+2"), and the request is refused if a known identifier remains. Replies are decoded inside the app. This is pseudonymization, not HIPAA Safe Harbor de-identification: session times, minutes, therapy types and missed-session reasons still go to the vendor. A business associate agreement or a local model remains the stronger option.
- [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html) explains the applicable business associate obligations. Encryption is not a substitute for vendor review.
- AI write requests become stored concrete session proposals. Only their authenticated creator can approve them. Plans expire after ten minutes and must be regenerated if the board or relevant clinical records change. Bulk requests must be enumerated as explicit sessions; broad automatic write tools are not exposed to the model.
- Approval retries return the saved result and do not repeat the batch. A running proposal after a server interruption requires manual reconciliation, not automatic resubmission. Partial failures stop the remaining changes and remain visible. Undo refuses later board/clinical changes and restores only the proposal's own affected sessions.

## Authentication decisions still requiring the organization

There is no approved SSO provider yet. Do not invent an organization identity provider or
represent email sign-in as MFA. Select and configure an approved SSO/passkey solution,
require appropriate administrator assurance, and test account recovery before mandating it.
See [NIST authentication guidance](https://pages.nist.gov/800-63-4/sp800-63b.html).

Three incorrect emails pause requests for the current browser. A separate 100-request
network abuse limit limits cookie-reset attacks without treating three staff typos as a
facility-wide lockout. Shared networks and browser recovery should be part of the pilot.

## Staff pilot: measure workflow, not just opinions

Use synthetic records first, then an approved supervised pilot with representative PT, OT,
SLP, float/weekend staff, and a manager. Observe tasks without coaching:

| Task | Evidence to capture |
| --- | --- |
| Sign in on a shared device; recover from an incorrect email | Success, elapsed time, unexpected lockouts, clear recovery |
| Record refusal, tolerance limits, or a clinical hold | Correct patient/status/reason; scheduled vs delivered minutes remain distinct |
| Cover an absence and revise a schedule | Conflicts, wrong-patient actions, change recovery, interruptions |
| Save a partial assessment, then complete and sign | Draft status, missing reasons, unauthorized access blocked, signature immutability |
| Review and approve an AI plan; retry after connection loss | Correct sessions, no duplicate actions, partial-failure comprehension |
| Correct documentation after signing | Preserved signature/history, clear correction process |
| Review patient goals and discharge planning | Goals/current function/tolerance considered alongside minutes |

Compare task completion, errors, lost changes, duplicate entry, time per task, and total
documentation time with the existing workflow. Record sample size, roles, setting, and
interruptions. Agree on acceptance thresholds with clinical leadership before the pilot;
there is no universal evidence-based time/click target. Any cross-patient write, lost
signed record, or duplicate approval is a release blocker. Fix observed problems and repeat
the affected tasks. A passing software test suite is not a clinical usability study.

## Recovery drill

Define the facility's recovery time/data-loss objectives and backup retention/access
owners. Restore a backup into an isolated environment, verify integrity and message-key
recovery, compare counts and signed records, run the synthetic workflows above, and record
elapsed time and backup age. Never replace the live database during a drill. Vendor
contracts, actual backup availability, offsite recovery, and clinical pilot results must
be verified by the organization; this repository cannot establish them.
