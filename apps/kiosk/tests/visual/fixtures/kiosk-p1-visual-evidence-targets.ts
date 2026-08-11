export type VisualReferenceKind =
  | 'PRIMARY'
  | 'SUBVIEW_STATE'
  | 'ROUTE_STATE'
  | 'REUSE'
  | 'REDIRECT'
  | 'NO_INDEPENDENT_PROTOTYPE'

export type VisualTargetGroup = 'PRIMARY_TARGET' | 'FUSION_STATE_REFERENCE'

export interface VisualEvidenceTarget {
  targetId: string
  targetGroup: VisualTargetGroup
  prototypePath: string
  referenceKind: VisualReferenceKind
  routeOrState: readonly string[]
  captureUrls: readonly string[]
  viewport: { readonly width: number; readonly height: number }
  fixture: string
  precondition: string
  readyMarker: string
  claimScope: string
  knownLimits: string
  capturePairs: readonly {
    readonly captureKey: string
    readonly captureUrl: string
    readonly readyMarker: string
    readonly screenshotPair: {
      readonly prototype: string
      readonly production: string
    }
  }[]
}

export interface RouteEvidenceDisposition {
  routePattern: string
  referenceKind: VisualReferenceKind
  targetIds: readonly string[]
  captureUrl: string | null
  redirectTo: string | null
  precondition: string
  claimScope: string
  knownLimits: string
}

export const migrationMatrixPath = 'docs/design/kiosk-proto-2026-07-migration-matrix.md'
export const screenshotRoot = 'test-results/kiosk-p1-visual-evidence/<sha>/'

const KIOSK_VIEWPORT = { width: 1080, height: 1920 } as const
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const
const DEFAULT_FIXTURE = 'contract-fixture: production-build browser interception using current response envelopes; unregistered requests fail closed.'
const DEFAULT_CLAIM = 'Prototype/production screenshot-pair contract and visible browser state only.'
const DEFAULT_LIMITS = 'Capture is pending until executed; it does not prove preproduction APIs, payment, TRTC, Terminal Agent, Windows host, printer, scanner, or pixel acceptance.'

type EvidenceTargetInput = Omit<VisualEvidenceTarget, 'viewport' | 'fixture' | 'claimScope' | 'knownLimits' | 'capturePairs'>
  & Partial<Pick<VisualEvidenceTarget, 'viewport' | 'fixture' | 'claimScope' | 'knownLimits'>>
  & {
    captureKeys?: readonly string[]
    captureReadyMarkers?: readonly string[]
  }

function evidenceTarget(input: EvidenceTargetInput): VisualEvidenceTarget {
  const {
    captureKeys = input.captureUrls.map(() => 'default'),
    captureReadyMarkers = input.captureUrls.map(() => input.readyMarker),
    ...target
  } = input
  return {
    viewport: KIOSK_VIEWPORT,
    fixture: DEFAULT_FIXTURE,
    claimScope: DEFAULT_CLAIM,
    knownLimits: DEFAULT_LIMITS,
    ...target,
    capturePairs: input.captureUrls.map((captureUrl, index) => ({
      captureKey: captureKeys[index] ?? `capture-${index + 1}`,
      captureUrl,
      readyMarker: captureReadyMarkers[index] ?? input.readyMarker,
      screenshotPair: {
        prototype: `${screenshotRoot}targets/${input.targetId}/${captureKeys[index] ?? `capture-${index + 1}`}/prototype.png`,
        production: `${screenshotRoot}targets/${input.targetId}/${captureKeys[index] ?? `capture-${index + 1}`}/production.png`,
      },
    })),
  }
}

const primary = (input: Omit<Parameters<typeof evidenceTarget>[0], 'targetGroup'>) => evidenceTarget({ targetGroup: 'PRIMARY_TARGET', ...input })
const fusionState = (input: Omit<Parameters<typeof evidenceTarget>[0], 'targetGroup' | 'referenceKind'>) => evidenceTarget({ targetGroup: 'FUSION_STATE_REFERENCE', referenceKind: 'ROUTE_STATE', ...input })

export const visualEvidenceTargets: readonly VisualEvidenceTarget[] = [
  primary({ targetId: '01', prototypePath: 'docs/design/kiosk-proto-2026-07/01-home.html', referenceKind: 'PRIMARY', routeOrState: ['/'], captureUrls: ['/'], precondition: 'Open as a guest with fail-closed service fixtures.', readyMarker: '.kpv1' }),
  primary({ targetId: '02', prototypePath: 'docs/design/kiosk-proto-2026-07/02-print-hub.html', referenceKind: 'PRIMARY', routeOrState: ['/print-scan'], captureUrls: ['/print-scan'], precondition: 'Return the configured print/scan capabilities envelope.', readyMarker: '[data-w2-page="print-scan-home"]' }),
  primary({ targetId: '03', prototypePath: 'docs/design/kiosk-proto-2026-07/03-print-settings.html', referenceKind: 'PRIMARY', routeOrState: ['/print/params'], captureUrls: ['/print/params'], precondition: 'Enter with a contract file context and price configuration.', readyMarker: '[data-w2-page="print-params"]' }),
  primary({ targetId: '04', prototypePath: 'docs/design/kiosk-proto-2026-07/04-print-progress.html', referenceKind: 'PRIMARY', routeOrState: ['/print/progress#active'], captureUrls: ['/print/progress'], precondition: 'Enter from the confirmed print flow with an active contract task.', readyMarker: '[data-w2-page="print-progress"]' }),
  primary({ targetId: '05', prototypePath: 'docs/design/kiosk-proto-2026-07/05-resume-source.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/source'], captureUrls: ['/resume/source'], precondition: 'Open the resume source chooser with no user document injected.', readyMarker: '[data-kiosk-screen="resume-source"]' }),
  primary({ targetId: '06', prototypePath: 'docs/design/kiosk-proto-2026-07/06-resume-diagnosis.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/report'], captureUrls: ['/resume/report'], precondition: 'Provide a synthetic diagnosis response through the current API envelope.', readyMarker: '[data-kiosk-screen="resume-report"]' }),
  primary({ targetId: '07', prototypePath: 'docs/design/kiosk-proto-2026-07/07-resume-optimize.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/optimize'], captureUrls: ['/resume/optimize'], precondition: 'Provide synthetic original and suggestion sections without personal data.', readyMarker: '[data-kiosk-screen="resume-optimize"]' }),
  primary({ targetId: '08', prototypePath: 'docs/design/kiosk-proto-2026-07/08-jobs-list.html', referenceKind: 'PRIMARY', routeOrState: ['/jobs'], captureUrls: ['/jobs'], precondition: 'Return a synthetic sourced-job list using the current jobs envelope.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '09', prototypePath: 'docs/design/kiosk-proto-2026-07/09-job-detail.html', referenceKind: 'PRIMARY', routeOrState: ['/jobs/:id'], captureUrls: ['/jobs/job-001'], precondition: 'Return one synthetic third-party job and source metadata.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '10', prototypePath: 'docs/design/kiosk-proto-2026-07/10-fairs-list.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs'], captureUrls: ['/job-fairs'], precondition: 'Return a synthetic official-source fair list.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '11', prototypePath: 'docs/design/kiosk-proto-2026-07/11-fair-detail.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id'], captureUrls: ['/job-fairs/fair-001'], precondition: 'Return one synthetic fair with companies, zones, and source metadata.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '12', prototypePath: 'docs/design/kiosk-proto-2026-07/12-policy.html', referenceKind: 'PRIMARY', routeOrState: ['/renshi'], captureUrls: ['/renshi'], precondition: 'Return synthetic published policy cards and preserve information-only wording.', readyMarker: '.w4-policy-page' }),
  primary({ targetId: '13', prototypePath: 'docs/design/kiosk-proto-2026-07/13-assistant.html', referenceKind: 'PRIMARY', routeOrState: ['/assistant#text-state'], captureUrls: ['/assistant'], precondition: 'Open the assistant text state without starting a call.', readyMarker: '[data-kiosk-screen="assistant"]' }),
  primary({ targetId: '14', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/14-profile.html', referenceKind: 'PRIMARY', routeOrState: ['/profile'], captureUrls: ['/profile'], precondition: 'Use the visible login flow to establish a synthetic member session.', readyMarker: '[data-kiosk-screen="profile"]' }),
  primary({ targetId: '15', prototypePath: 'docs/design/kiosk-proto-2026-07/15-login.html', referenceKind: 'PRIMARY', routeOrState: ['/login#default'], captureUrls: ['/login'], precondition: 'Open the default login chooser with synthetic QR and SMS contracts.', readyMarker: '[data-kiosk-screen="login"]' }),
  primary({ targetId: '16', prototypePath: 'docs/design/kiosk-proto-2026-07/16-me-resumes.html', referenceKind: 'PRIMARY', routeOrState: ['/me/resumes'], captureUrls: ['/me/resumes'], precondition: 'Authenticate through the visible flow and return synthetic resume records.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '17', prototypePath: 'docs/design/kiosk-proto-2026-07/17-me-documents.html', referenceKind: 'PRIMARY', routeOrState: ['/me/documents'], captureUrls: ['/me/documents'], precondition: 'Authenticate through the visible flow and return synthetic document metadata only.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '18', prototypePath: 'docs/design/kiosk-proto-2026-07/18-me-print-orders.html', referenceKind: 'PRIMARY', routeOrState: ['/me/print-orders'], captureUrls: ['/me/print-orders'], precondition: 'Authenticate through the visible flow and return synthetic non-secret order summaries.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '19', prototypePath: 'docs/design/kiosk-proto-2026-07/19-me-ai-records.html', referenceKind: 'PRIMARY', routeOrState: ['/me/ai-records'], captureUrls: ['/me/ai-records'], precondition: 'Authenticate through the visible flow and return synthetic AI record metadata.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '20', prototypePath: 'docs/design/kiosk-proto-2026-07/20-me-favorites.html', referenceKind: 'PRIMARY', routeOrState: ['/me/favorites'], captureUrls: ['/me/favorites'], precondition: 'Authenticate through the visible flow and return synthetic favorites.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '21', prototypePath: 'docs/design/kiosk-proto-2026-07/21-me-benefits.html', referenceKind: 'PRIMARY', routeOrState: ['/me/benefits'], captureUrls: ['/me/benefits'], precondition: 'Authenticate through the visible flow and return synthetic benefit balances.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '22', prototypePath: 'docs/design/kiosk-proto-2026-07/22-me-notifications.html', referenceKind: 'PRIMARY', routeOrState: ['/me/notifications'], captureUrls: ['/me/notifications'], precondition: 'Authenticate through the visible flow and return synthetic notifications.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '23', prototypePath: 'docs/design/kiosk-proto-2026-07/23-me-settings.html', referenceKind: 'PRIMARY', routeOrState: ['/me/settings'], captureUrls: ['/me/settings'], precondition: 'Authenticate through the visible flow and return the current consent-status envelope.', readyMarker: '[data-kiosk-screen="member-settings"]' }),
  primary({ targetId: '24', prototypePath: 'docs/design/kiosk-proto-2026-07/24-activities.html', referenceKind: 'PRIMARY', routeOrState: ['/activities'], captureUrls: ['/activities'], precondition: 'Return a synthetic published activity list.', readyMarker: '[data-kiosk-screen="activities"]' }),
  primary({ targetId: '25', prototypePath: 'docs/design/kiosk-proto-2026-07/25-resume-generate.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/generate'], captureUrls: ['/resume/generate'], precondition: 'Open the blank generator form; do not submit personal information.', readyMarker: '[data-kiosk-screen="resume-generate"]' }),
  primary({ targetId: '26', prototypePath: 'docs/design/kiosk-proto-2026-07/26-resume-generate-preview.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/generate/preview'], captureUrls: ['/resume/generate/preview'], precondition: 'Provide a synthetic generated-resume preview through the current envelope.', readyMarker: '[data-kiosk-screen="resume-generate-preview"]' }),
  primary({ targetId: '27', prototypePath: 'docs/design/kiosk-proto-2026-07/27-resume-parse.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/parse'], captureUrls: ['/resume/parse'], precondition: 'Enter with a synthetic file identifier and a deferred parse response.', readyMarker: '[data-kiosk-screen="resume-parse"]' }),
  primary({ targetId: '28', prototypePath: 'docs/design/kiosk-proto-2026-07/28-resume-export.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/export'], captureUrls: ['/resume/export'], precondition: 'Capture the honest no-artifact state unless a contract artifact is supplied.', readyMarker: '[data-kiosk-screen="resume-export"]' }),
  primary({ targetId: '29', prototypePath: 'docs/design/kiosk-proto-2026-07/29-resume-templates.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/templates'], captureUrls: ['/resume/templates'], precondition: 'Return synthetic template metadata without downloadable user files.', readyMarker: '[data-kiosk-screen="resume-templates"]' }),
  primary({ targetId: '30', prototypePath: 'docs/design/kiosk-proto-2026-07/30-resume-materials.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/materials'], captureUrls: ['/resume/materials'], precondition: 'Return synthetic job-material template metadata.', readyMarker: '[data-kiosk-screen="resume-materials"]' }),
  primary({ targetId: '31', prototypePath: 'docs/design/kiosk-proto-2026-07/31-print-material-check.html', referenceKind: 'PRIMARY', routeOrState: ['/print/material-check'], captureUrls: ['/print/material-check'], precondition: 'Enter with a synthetic uploaded-file context and inspection envelope.', readyMarker: '[data-w2-page="print-material-check"]' }),
  primary({ targetId: '32', prototypePath: 'docs/design/kiosk-proto-2026-07/32-print-cashier.html', referenceKind: 'PRIMARY', routeOrState: ['/print/cashier#pending'], captureUrls: ['/print/cashier'], precondition: 'Enter with a synthetic unpaid order; never expose reusable payment data.', readyMarker: '[data-w2-page="print-cashier"]' }),
  primary({ targetId: '33', prototypePath: 'docs/design/kiosk-proto-2026-07/33-print-done.html', referenceKind: 'PRIMARY', routeOrState: ['/print/done#completed'], captureUrls: ['/print/done'], precondition: 'Provide a synthetic task whose server status is completed.', readyMarker: '[data-w2-page="print-done"]' }),
  primary({ targetId: '34', prototypePath: 'docs/design/kiosk-proto-2026-07/34-scan-start.html', referenceKind: 'PRIMARY', routeOrState: ['/scan/start#ready'], captureUrls: ['/scan/start'], precondition: 'Open the scan chooser before creating any scan session.', readyMarker: '[data-w2-page="scan-start"]' }),
  primary({ targetId: '35', prototypePath: 'docs/design/kiosk-proto-2026-07/35-scan-settings.html', referenceKind: 'PRIMARY', routeOrState: ['/scan/settings#created'], captureUrls: ['/scan/settings'], precondition: 'Enter through the visible start action and return synthetic server instructions.', readyMarker: '[data-w2-page="scan-settings"]' }),
  primary({ targetId: '36', prototypePath: 'docs/design/kiosk-proto-2026-07/36-scan-progress.html', referenceKind: 'PRIMARY', routeOrState: ['/scan/progress#active'], captureUrls: ['/scan/progress'], precondition: 'Enter from a created synthetic session and return an active status.', readyMarker: '[data-w2-page="scan-progress"]' }),
  primary({ targetId: '37', prototypePath: 'docs/design/kiosk-proto-2026-07/37-scan-result.html', referenceKind: 'PRIMARY', routeOrState: ['/scan/result#completed'], captureUrls: ['/scan/result'], precondition: 'Enter from a completed synthetic session with non-personal result metadata.', readyMarker: '[data-w2-page="scan-result"]' }),
  primary({ targetId: '38', prototypePath: 'docs/design/kiosk-proto-2026-07/38-interview-setup.html', referenceKind: 'PRIMARY', routeOrState: ['/interview/setup'], captureUrls: ['/interview/setup'], precondition: 'Open the blank setup form without uploading a resume.', readyMarker: '[data-kiosk-screen="interview-setup"]' }),
  primary({ targetId: '39', prototypePath: 'docs/design/kiosk-proto-2026-07/39-interview-session.html', referenceKind: 'PRIMARY', routeOrState: ['/interview/session'], captureUrls: ['/interview/session'], precondition: 'Provide a synthetic interview session and question.', readyMarker: '[data-kiosk-screen="interview-session"]' }),
  primary({ targetId: '40', prototypePath: 'docs/design/kiosk-proto-2026-07/40-interview-report.html', referenceKind: 'PRIMARY', routeOrState: ['/interview/report'], captureUrls: ['/interview/report'], precondition: 'Provide a synthetic interview report without user content.', readyMarker: '[data-kiosk-screen="interview-report"]' }),
  primary({ targetId: '41', prototypePath: 'docs/design/kiosk-proto-2026-07/41-interview-tips.html', referenceKind: 'PRIMARY', routeOrState: ['/interview/tips'], captureUrls: ['/interview/tips'], precondition: 'Open the static interview tips route.', readyMarker: '[data-kiosk-screen="interview-tips"]' }),
  primary({ targetId: '42', prototypePath: 'docs/design/kiosk-proto-2026-07/42-interview-reports.html', referenceKind: 'PRIMARY', routeOrState: ['/interview/reports'], captureUrls: ['/interview/reports'], precondition: 'Authenticate visibly and return synthetic report summaries.', readyMarker: '[data-kiosk-screen="interview-reports"]' }),
  primary({ targetId: '43', prototypePath: 'docs/design/kiosk-proto-2026-07/43-fair-checkin.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/checkin'], captureUrls: ['/job-fairs/checkin'], precondition: 'Return a synthetic official-source fair and external check-in link.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '44', prototypePath: 'docs/design/kiosk-proto-2026-07/44-fair-companies.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/companies'], captureUrls: ['/job-fairs/fair-001/companies'], precondition: 'Return synthetic fair companies and zones.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '45', prototypePath: 'docs/design/kiosk-proto-2026-07/45-fair-company-detail.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/companies/:companyId'], captureUrls: ['/job-fairs/fair-001/companies/fair-company-001'], precondition: 'Return one synthetic fair company with sourced jobs.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '46', prototypePath: 'docs/design/kiosk-proto-2026-07/46-fair-map.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/map'], captureUrls: ['/job-fairs/fair-001/map'], precondition: 'Return synthetic fair map metadata through the current envelope.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '47', prototypePath: 'docs/design/kiosk-proto-2026-07/47-fair-materials.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/materials'], captureUrls: ['/job-fairs/fair-001/materials'], precondition: 'Return synthetic printable-material metadata without signed URLs.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '48', prototypePath: 'docs/design/kiosk-proto-2026-07/48-fair-visit-plan.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/visit-plan'], captureUrls: ['/job-fairs/fair-001/visit-plan'], precondition: 'Authenticate visibly and return a synthetic visit plan.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '49', prototypePath: 'docs/design/kiosk-proto-2026-07/49-fair-stats.html', referenceKind: 'PRIMARY', routeOrState: ['/job-fairs/:id/stats'], captureUrls: ['/job-fairs/fair-001/stats'], precondition: 'Return synthetic aggregate fair statistics without personal data.', readyMarker: 'text=真实数据正在接入' }),
  primary({ targetId: '50', prototypePath: 'docs/design/kiosk-proto-2026-07/50-campus.html', referenceKind: 'PRIMARY', routeOrState: ['/campus'], captureUrls: ['/campus'], precondition: 'Return synthetic campus fair content using current envelopes.', readyMarker: '.campus-proto' }),
  primary({ targetId: '51', prototypePath: 'docs/design/kiosk-proto-2026-07/51-smart-campus.html', referenceKind: 'PRIMARY', routeOrState: ['/smart-campus'], captureUrls: ['/smart-campus'], precondition: 'Enable only the synthetic allowlisted smart-campus cards.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '52', prototypePath: 'docs/design/kiosk-proto-2026-07/52-smart-campus-service.html', referenceKind: 'PRIMARY', routeOrState: ['/smart-campus/service/:key'], captureUrls: ['/smart-campus/service/campus-card'], precondition: 'Open an allowlisted static service key.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '53', prototypePath: 'docs/design/kiosk-proto-2026-07/53-companies.html', referenceKind: 'PRIMARY', routeOrState: ['/companies'], captureUrls: ['/companies'], precondition: 'Return a synthetic sourced-company list and aggregates.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '54', prototypePath: 'docs/design/kiosk-proto-2026-07/54-company-detail.html', referenceKind: 'PRIMARY', routeOrState: ['/companies/:id'], captureUrls: ['/companies/company-001'], precondition: 'Return one synthetic sourced company and job list.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '55', prototypePath: 'docs/design/kiosk-proto-2026-07/55-job-fit.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/job-fit'], captureUrls: ['/resume/job-fit'], precondition: 'Use synthetic consent and comparison inputs without user resume content.', readyMarker: '[data-kiosk-screen="resume-job-fit"]' }),
  primary({ targetId: '56', prototypePath: 'docs/design/kiosk-proto-2026-07/56-career-plan.html', referenceKind: 'PRIMARY', routeOrState: ['/resume/career-plan'], captureUrls: ['/resume/career-plan'], precondition: 'Authenticate visibly and return a synthetic career plan.', readyMarker: '[data-kiosk-screen="resume-career-plan"]' }),
  primary({ targetId: '57', prototypePath: 'docs/design/kiosk-proto-2026-07/57-screensaver.html', referenceKind: 'PRIMARY', routeOrState: ['/screensaver'], captureUrls: ['/screensaver'], precondition: 'Seed one synthetic non-identifying playlist item through navigation state.', readyMarker: '[data-kiosk-screen="screensaver"]' }),
  primary({ targetId: '58', prototypePath: 'docs/design/kiosk-proto-2026-07/58-help.html', referenceKind: 'PRIMARY', routeOrState: ['/help'], captureUrls: ['/help'], precondition: 'Open the static help route.', readyMarker: '[data-kiosk-screen="help"]' }),
  primary({ targetId: '59', prototypePath: 'docs/design/kiosk-proto-2026-07/59-legal.html', referenceKind: 'PRIMARY', routeOrState: ['/legal/:doc'], captureUrls: ['/legal/privacy'], precondition: 'Return synthetic long-form privacy text from the current legal endpoint.', readyMarker: '[data-kiosk-screen="legal-doc"]' }),
  primary({ targetId: '60', prototypePath: 'docs/design/kiosk-proto-2026-07/60-session-timeout.html', referenceKind: 'PRIMARY', routeOrState: ['/session-timeout'], captureUrls: ['/session-timeout'], precondition: 'Open with a synthetic return location and reduced motion.', readyMarker: '[data-kiosk-screen="session-timeout"]' }),
  primary({ targetId: '61', prototypePath: 'docs/design/kiosk-proto-2026-07/61-error-offline.html', referenceKind: 'PRIMARY', routeOrState: ['/error-offline'], captureUrls: ['/error-offline'], precondition: 'Abort the health request with internetdisconnected.', readyMarker: '[data-kiosk-screen="error-offline"]' }),
  primary({ targetId: '62', prototypePath: 'docs/design/kiosk-proto-2026-07/62-phone-upload.html', referenceKind: 'PRIMARY', routeOrState: ['/upload/phone'], captureUrls: ['/upload/phone'], viewport: MOBILE_VIEWPORT, precondition: 'Open an expired synthetic upload session; do not select a real file.', readyMarker: '[data-kiosk-screen="phone-upload"]' }),
  primary({ targetId: '63', prototypePath: 'docs/design/kiosk-proto-2026-07/63-qr-login-mobile.html', referenceKind: 'PRIMARY', routeOrState: ['/member/qr-login'], captureUrls: ['/member/qr-login?ticketId=evidence-ticket'], viewport: MOBILE_VIEWPORT, precondition: 'Open a synthetic non-reusable ticket and intercept current login endpoints.', readyMarker: '[data-kiosk-screen="member-qr-login"]' }),
  primary({ targetId: '64', prototypePath: 'docs/design/kiosk-proto-2026-07/64-print-preview.html', referenceKind: 'PRIMARY', routeOrState: ['/print/preview'], captureUrls: ['/print/preview'], precondition: 'Enter with synthetic file metadata and price configuration.', readyMarker: '[data-w2-page="print-preview"]' }),
  primary({ targetId: '65', prototypePath: 'docs/design/kiosk-proto-2026-07/65-print-confirm.html', referenceKind: 'PRIMARY', routeOrState: ['/print/confirm'], captureUrls: ['/print/confirm'], precondition: 'Enter with synthetic inspected-file and print-parameter context.', readyMarker: '[data-w2-page="print-confirm"]' }),
  primary({ targetId: '66', prototypePath: 'docs/design/kiosk-proto-2026-07/66-print-scan-convert.html', referenceKind: 'PRIMARY', routeOrState: ['/print-scan/convert'], captureUrls: ['/print-scan/convert'], precondition: 'Open the empty conversion workspace; do not upload a real image.', readyMarker: '[data-w2-page="print-scan-convert"]' }),
  primary({ targetId: '67', prototypePath: 'docs/design/kiosk-proto-2026-07/67-print-scan-sign.html', referenceKind: 'PRIMARY', routeOrState: ['/print-scan/sign'], captureUrls: ['/print-scan/sign'], precondition: 'Open the empty signing workspace; do not upload a real signature.', readyMarker: '[data-w2-page="print-scan-sign"]' }),
  primary({ targetId: '68', prototypePath: 'docs/design/kiosk-proto-2026-07/68-print-scan-feature.html', referenceKind: 'PRIMARY', routeOrState: ['/print-scan/feature/:key'], captureUrls: ['/print-scan/feature/id-photo'], precondition: 'Open an allowlisted feature key in its honest availability state.', readyMarker: '[data-w2-page="print-scan-feature"]' }),
  primary({ targetId: '69', prototypePath: 'docs/design/kiosk-proto-2026-07/69-smart-campus-welcome.html', referenceKind: 'PRIMARY', routeOrState: ['/smart-campus/welcome'], captureUrls: ['/smart-campus/welcome'], precondition: 'Open the static smart-campus welcome route.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '70', prototypePath: 'docs/design/kiosk-proto-2026-07/70-freshman-insights.html', referenceKind: 'PRIMARY', routeOrState: ['/smart-campus/freshman-insights'], captureUrls: ['/smart-campus/freshman-insights'], precondition: 'Open the honest not-open smart-campus insights state.', readyMarker: '[data-kiosk-component="page-frame"]' }),
  primary({ targetId: '71', prototypePath: 'docs/design/kiosk-proto-2026-07/71-me-activity.html', referenceKind: 'PRIMARY', routeOrState: ['/me/activity'], captureUrls: ['/me/activity'], precondition: 'Authenticate visibly and return synthetic browse/jump metadata.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  primary({ targetId: '72', prototypePath: 'docs/design/kiosk-proto-2026-07/72-activity-detail.html', referenceKind: 'PRIMARY', routeOrState: ['/activities/:id'], captureUrls: ['/activities/activity-001'], precondition: 'Return one synthetic published benefit activity.', readyMarker: '[data-kiosk-screen="activity-detail"]' }),
  primary({ targetId: '73', prototypePath: 'docs/design/kiosk-proto-2026-07/73-assistant-call.html', referenceKind: 'SUBVIEW_STATE', routeOrState: ['/assistant#call-state'], captureUrls: ['/assistant'], precondition: 'From the visible assistant CTA, establish a synthetic eligible TRTC state and open AssistantCallPanel.', readyMarker: '[data-kiosk-screen="assistant"] [role="dialog"]' }),
  primary({ targetId: '74', prototypePath: 'docs/design/kiosk-proto-2026-07/74-job-detail-offline.html', referenceKind: 'PRIMARY', routeOrState: ['/jobs/:id/offline'], captureUrls: ['/jobs/offline-job-001/offline'], precondition: 'Return one synthetic offline-agency job and store metadata.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '75', prototypePath: 'docs/design/kiosk-proto-2026-07/75-offline-agencies.html', referenceKind: 'PRIMARY', routeOrState: ['/offline-agencies'], captureUrls: ['/offline-agencies'], precondition: 'Return synthetic agency locations using the current query envelope.', readyMarker: '.w4-page-frame' }),
  primary({ targetId: '76', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/76-toolbox-zone.html', referenceKind: 'PRIMARY', routeOrState: ['/toolbox#configured'], captureUrls: ['/toolbox'], precondition: 'Return an allowlisted configured toolbox service list.', readyMarker: '[data-kiosk-screen="toolbox"]' }),
  primary({ targetId: '77', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/77-print-upload.html', referenceKind: 'PRIMARY', routeOrState: ['/print/upload'], captureUrls: ['/print/upload'], precondition: 'Open the upload chooser without selecting a real document.', readyMarker: '[data-w2-page="print-upload"]' }),
  fusionState({ targetId: '15A', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/15A-login-error.html', routeOrState: ['/login#verification-error'], captureUrls: ['/login'], fixture: 'contract-fixture: reject the current SMS/verification request with its supported error envelope.', precondition: 'Use the visible login controls and submit synthetic invalid verification input.', readyMarker: '[data-kiosk-screen="login"] [role="alert"]' }),
  fusionState({ targetId: '22B', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/22B-me-feedback.html', routeOrState: ['/me/feedback'], captureUrls: ['/me/feedback'], precondition: 'Authenticate visibly and return synthetic feedback-ticket metadata.', readyMarker: '[data-kiosk-screen="member-list"]' }),
  fusionState({ targetId: '32A', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/32A-cashier-failed.html', routeOrState: ['/print/cashier#failed'], captureUrls: ['/print/cashier'], fixture: 'contract-fixture: return only supported failed, closed, expired-attempt, or refunded payment state.', precondition: 'Enter with a synthetic order whose payment state is failed.', readyMarker: '[data-w2-page="print-cashier"]' }),
  fusionState({ targetId: '34A', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/34A-scan-offline.html', routeOrState: ['/scan/start#pre-session', '/scan/settings#session-create-failed'], captureUrls: ['/scan/start', '/scan/settings'], captureKeys: ['scan-start', 'scan-settings'], captureReadyMarkers: ['[data-w2-page="scan-start"]:has-text("会话尚未创建")', '[data-w2-page="scan-settings"]:has-text("扫描任务未创建")'], fixture: 'contract-fixture: make no request on scan start; after the visible CTA reaches settings, reject only the current scan-session creation request with its supported unavailable response. Do not invent a device-status DTO.', precondition: 'Capture the honest pre-session boundary on start, then separately capture the failed session-creation branch on settings.', readyMarker: '[data-w2-page="scan-start"], [data-w2-page="scan-settings"]', knownLimits: 'The start page has no scanner-status knowledge; settings proves session-creation failure only. This does not prove a real scanner is offline.' }),
  fusionState({ targetId: '76A', prototypePath: 'docs/design/kiosk-proto-2026-07-fusion/76A-toolbox-empty.html', routeOrState: ['/toolbox#empty'], captureUrls: ['/toolbox'], precondition: 'Return a valid empty or disabled toolbox configuration.', readyMarker: '[data-kiosk-screen="toolbox"]' }),
]

const DEFAULT_ROUTE_PRECONDITION = 'Use the target contract fixture and wait for its ready marker.'
const DEFAULT_ROUTE_CLAIM = 'Route disposition and capture ownership only.'
const DEFAULT_ROUTE_LIMITS = 'No screenshot or environment result is implied until the target capture is executed.'

function routeDisposition(input: Pick<RouteEvidenceDisposition, 'routePattern' | 'referenceKind' | 'targetIds' | 'captureUrl'> & Partial<Omit<RouteEvidenceDisposition, 'routePattern' | 'referenceKind' | 'targetIds' | 'captureUrl'>>): RouteEvidenceDisposition {
  return {
    redirectTo: null,
    precondition: DEFAULT_ROUTE_PRECONDITION,
    claimScope: DEFAULT_ROUTE_CLAIM,
    knownLimits: DEFAULT_ROUTE_LIMITS,
    ...input,
  }
}

const route = (routePattern: string, targetIds: readonly string[], captureUrl = routePattern, referenceKind: VisualReferenceKind = 'PRIMARY') => routeDisposition({ routePattern, targetIds, captureUrl, referenceKind })
const redirect = (routePattern: string, redirectTo: string) => routeDisposition({ routePattern, referenceKind: 'REDIRECT', targetIds: [], captureUrl: null, redirectTo, precondition: `Navigate to ${routePattern} and assert replace navigation to ${redirectTo}.`, claimScope: 'Compatibility redirect behavior only; no visual pair is generated.', knownLimits: 'The destination owns the visual target and screenshot evidence.' })
const productionOnly = (routePattern: string) => routeDisposition({ routePattern, referenceKind: 'NO_INDEPENDENT_PROTOTYPE', targetIds: [], captureUrl: routePattern, precondition: 'Capture production presentation without fabricating a prototype counterpart.', claimScope: 'Production-only route evidence and explicit prototype-gap record.', knownLimits: 'No independent prototype exists; no screenshot pair may be claimed.' })

export const routeEvidenceDispositions: readonly RouteEvidenceDisposition[] = [
  route('/', ['01']),
  route('/login', ['15', '15A'], '/login'),
  route('/member/qr-login', ['63'], '/member/qr-login?ticketId=evidence-ticket'),
  route('/upload/phone', ['62']),
  route('/legal/:doc', ['59'], '/legal/privacy'),
  route('/resume/job-fit', ['55']),
  route('/resume/career-plan', ['56']),
  route('/interview/setup', ['38']),
  route('/interview/session', ['39']),
  route('/interview/report', ['40']),
  route('/interview/tips', ['41']),
  route('/interview/reports', ['42']),
  route('/screensaver', ['57']),
  route('/session-timeout', ['60']),
  route('/error-offline', ['61']),
  route('/assistant', ['13', '73'], '/assistant'),
  route('/profile', ['14']),
  route('/me/resumes', ['16']),
  route('/me/print-orders', ['18']),
  route('/me/documents', ['17']),
  route('/me/favorites', ['20']),
  route('/me/ai-records', ['19']),
  route('/me/benefits', ['21']),
  route('/me/activity', ['71']),
  routeDisposition({ routePattern: '/me/activity/:id', referenceKind: 'REUSE', targetIds: ['71'], captureUrl: '/me/activity/evidence-record', knownLimits: 'The list prototype is structural guidance only; this detail route has no independent prototype.' }),
  route('/me/notifications', ['22']),
  route('/me/feedback', ['22B'], '/me/feedback', 'ROUTE_STATE'),
  route('/me/settings', ['23']),
  routeDisposition({ routePattern: '/me/privacy-requests', referenceKind: 'NO_INDEPENDENT_PROTOTYPE', targetIds: [], captureUrl: '/me/privacy-requests', precondition: 'Capture production presentation without fabricating a prototype counterpart.', claimScope: 'Production-only route evidence and explicit prototype-gap record.', knownLimits: 'No independent 8399/Fusion prototype exists; no screenshot pair may be claimed.' }),
  route('/help', ['58']),
  route('/activities', ['24']),
  route('/activities/:id', ['72'], '/activities/activity-001'),
  route('/renshi', ['12']),
  route('/campus', ['50']),
  routeDisposition({ routePattern: '/campus/welcome', referenceKind: 'REUSE', targetIds: ['69'], captureUrl: '/campus/welcome', knownLimits: 'Target 69 supplies structure only; campus recruitment welcome remains semantically distinct from smart campus.' }),
  routeDisposition({ routePattern: '/campus/freshman-insights', referenceKind: 'REUSE', targetIds: ['70'], captureUrl: '/campus/freshman-insights', knownLimits: 'Target 70 supplies the honest unavailable-state structure only; the two campus domains are not aliases.' }),
  route('/toolbox', ['76', '76A'], '/toolbox'),
  route('/smart-campus', ['51']),
  route('/smart-campus/welcome', ['69']),
  route('/smart-campus/freshman-insights', ['70']),
  route('/smart-campus/service/:key', ['52'], '/smart-campus/service/campus-card'),
  route('/print-scan', ['02']),
  route('/print-scan/feature/:key', ['68'], '/print-scan/feature/id-photo'),
  route('/print-scan/convert', ['66']),
  route('/print-scan/sign', ['67']),
  redirect('/print/scan-convert', '/print-scan/convert'),
  redirect('/print/scan-sign', '/print-scan/sign'),
  redirect('/print/scan-feature', '/print-scan/feature/id-photo'),
  route('/print/upload', ['77']),
  route('/print/material-check', ['31']),
  route('/print/preview', ['64']),
  route('/print/params', ['03']),
  route('/print/confirm', ['65']),
  route('/print/cashier', ['32', '32A'], '/print/cashier'),
  route('/print/progress', ['04']),
  route('/print/done', ['33']),
  redirect('/resume', '/resume/source'),
  redirect('/resume/upload', '/resume/source'),
  route('/resume/source', ['05']),
  route('/resume/generate', ['25']),
  route('/resume/generate/preview', ['26']),
  route('/resume/parse', ['27']),
  route('/resume/report', ['06']),
  route('/resume/optimize', ['07']),
  route('/resume/export', ['28']),
  route('/resume/templates', ['29']),
  route('/resume/materials', ['30']),
  productionOnly('/resume-service'),
  route('/scan/start', ['34', '34A'], '/scan/start'),
  route('/scan/settings', ['35', '34A'], '/scan/settings'),
  route('/scan/progress', ['36']),
  route('/scan/result', ['37']),
  route('/jobs', ['08']),
  productionOnly('/jobs-service'),
  route('/jobs/:id', ['09'], '/jobs/job-001'),
  route('/jobs/:id/offline', ['74'], '/jobs/offline-job-001/offline'),
  route('/offline-agencies', ['75']),
  routeDisposition({ routePattern: '/offline-agencies/:id', referenceKind: 'REUSE', targetIds: ['75'], captureUrl: '/offline-agencies/evidence-agency', knownLimits: 'The agency-list prototype is structural guidance only; this detail route has no independent prototype.' }),
  routeDisposition({ routePattern: '/notifications', referenceKind: 'REUSE', targetIds: ['22'], captureUrl: '/notifications', knownLimits: 'Target 22 supplies notification structure only; this top-level route is distinct from the member route.' }),
  route('/companies', ['53']),
  route('/companies/:id', ['54'], '/companies/company-001'),
  route('/job-fairs', ['10']),
  productionOnly('/fairs-service'),
  route('/job-fairs/checkin', ['43']),
  route('/job-fairs/:id', ['11'], '/job-fairs/fair-001'),
  route('/job-fairs/:id/companies', ['44'], '/job-fairs/fair-001/companies'),
  route('/job-fairs/:id/companies/:companyId', ['45'], '/job-fairs/fair-001/companies/fair-company-001'),
  route('/job-fairs/:id/map', ['46'], '/job-fairs/fair-001/map'),
  route('/job-fairs/:id/materials', ['47'], '/job-fairs/fair-001/materials'),
  route('/job-fairs/:id/visit-plan', ['48'], '/job-fairs/fair-001/visit-plan'),
  route('/job-fairs/:id/stats', ['49'], '/job-fairs/fair-001/stats'),
  productionOnly('/interview-service'),
  productionOnly('/policy-service'),
  productionOnly('/resume/self-assessment/intro'),
  productionOnly('/resume/self-assessment/questions'),
  productionOnly('/resume/self-assessment/result'),
  productionOnly('/resume/self-assessment/history'),
  productionOnly('/ai/plan'),
  productionOnly('/session-resume'),
  productionOnly('/jobs/online-platforms'),
  productionOnly('/contract-review'),
  productionOnly('/contract-review/processing'),
  productionOnly('/contract-review/result'),
]
