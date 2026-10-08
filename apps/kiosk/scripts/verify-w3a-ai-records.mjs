import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..')
const read = (file) => readFileSync(resolve(root, file), 'utf8')
for (const page of ['Documents', 'Resumes', 'AiRecords', 'Benefits', 'Activity', 'Notifications']) {
  const source = read(`src/pages/profile/me/My${page}Page.tsx`)
  assert.ok(source.includes('useMemberCursorPage') && source.includes('MemberLoadMore'), `${page}: real cursor hook and touch action`)
}
const feedbackSource = read('src/pages/profile/me/MyFeedbackPage.tsx')
assert.ok(feedbackSource.includes('useMemberCursorPage'), 'Feedback: real cursor hook')
const feedbackListPanel = feedbackSource.match(/<FeedbackListPanel\b[\s\S]*?\/>/)?.[0] ?? ''
assert.ok([
  'nextCursor={pagination.nextCursor}',
  'loadingMore={pagination.loadingMore}',
  'loadMoreError={pagination.loadMoreError}',
  'loadMore={() => void pagination.loadMore()}',
].every((prop) => feedbackListPanel.includes(prop)), 'Feedback: rendered list panel receives real cursor pagination')
assert.match(read('src/pages/profile/me/feedback/FeedbackListPanel.tsx'), /<MemberLoadMore\b/, 'Feedback: list panel renders touch action')
assert.match(read('src/pages/profile/me/MemberLoadMore.tsx'), /minHeight: 56/)
assert.match(read('src/pages/profile/me/MyDocumentsPage.tsx'), /items.length === 0 && !pagination.nextCursor/)
assert.match(read('src/pages/profile/me/MyResumesPage.tsx'), /confirmDelete.ownerToken === token/)
assert.match(read('src/pages/profile/me/MyResumesPage.tsx'), /taskId: item.taskId, resumeName: resumeLabel\(item\)/)
assert.match(read('src/pages/profile/me/MyResumesPage.tsx'), /await deleteMyResume\(token, confirmDelete.id\)/)
assert.match(read('src/pages/profile/me/MyResumesPage.tsx'), /clearResumeReferences\(confirmDelete.taskId\)/)
assert.match(read('src/pages/profile/me/QaRecords.tsx'), /sessionId: item.sessionId, artifactId: item.artifactId/)
assert.match(read('src/pages/resume/SelfAssessmentFlow.tsx'), /linkedTaskId \? 'fetch' : consentOk && pendingComplete \? 'submit'/)
assert.match(read('src/pages/resume/CareerPlanPage.tsx'), /queryTaskId \?\? state.taskId \?\? session\?\.taskId/)
assert.match(read('src/auth/KioskPrivacyGuard.tsx'), /busyRef.current && now < busyCapDeadline/)
execFileSync(process.execPath, ['--test', resolve(root, 'scripts/tests/w3a-ai-records.test.mjs')], { stdio: 'inherit' })
console.log('PASS W3-a cursor, restore, delete and bounded busy contracts')
