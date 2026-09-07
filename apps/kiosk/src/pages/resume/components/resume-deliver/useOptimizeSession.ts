import { useState } from 'react'
import type { GeneratedResume, ResumeExportFormat, ResumeGenerateExportResponse, ResumeOptimizeModule, ResumeTemplate } from '@ai-job-print/shared'
import type { ResumeLayoutAdjustAction } from '../../../../services/api/ai'
import type { ResumeDecisionMap } from './resumeDecisions'

type LeaveAction = () => void
type FailKind = 'retry' | 'reparse' | 'expired' | 'consent' | 'outage'

export function useOptimizeSession(format: ResumeExportFormat, loggedIn: boolean) {
  const [modules, setModules] = useState<ResumeOptimizeModule[]>([])
  const [optimizedResume, setOptimizedResume] = useState<GeneratedResume | null>(null)
  const [loading, setLoading] = useState(true)
  const [failKind, setFailKind] = useState<FailKind>('reparse')
  const [failMsg, setFailMsg] = useState<string | null>(null)
  const [retryNonce, setRetryNonce] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [printNavigating, setPrintNavigating] = useState(false)
  const [exportFormat, setExportFormat] = useState<ResumeExportFormat>(format)
  const [exported, setExported] = useState<ResumeGenerateExportResponse | null>(null)
  const [exportKind, setExportKind] = useState<'resume' | 'change_list'>('resume')
  const [exportVersion, setExportVersion] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [resumeTemplates, setResumeTemplates] = useState<ResumeTemplate[]>([])
  const [templatesError, setTemplatesError] = useState(false)
  const [selectedTemplateId, setSelectedTemplateId] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState<LeaveAction | null>(null)
  const [adjusting, setAdjusting] = useState<ResumeLayoutAdjustAction | null>(null)
  const [lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust] = useState<GeneratedResume | null>(null)
  const [adjustWarnings, setAdjustWarnings] = useState<string[]>([])
  const [adjustError, setAdjustError] = useState<string | null>(null)
  const [factOpen, setFactOpen] = useState<'resume' | 'change_list' | null>(null)
  const [savedToDocuments, setSavedToDocuments] = useState<boolean | undefined>(undefined)
  const [decisions, setDecisions] = useState<ResumeDecisionMap>({})
  const [draftAccepted, setDraftAccepted] = useState(!loggedIn)

  return {
    modules, setModules, optimizedResume, setOptimizedResume, loading, setLoading,
    failKind, setFailKind, failMsg, setFailMsg, retryNonce, setRetryNonce,
    exporting, setExporting, printNavigating, setPrintNavigating, exportFormat, setExportFormat,
    exported, setExported, exportKind, setExportKind, exportVersion, setExportVersion,
    previewOpen, setPreviewOpen, exportError, setExportError, resumeTemplates, setResumeTemplates,
    templatesError, setTemplatesError, selectedTemplateId, setSelectedTemplateId,
    isDirty, setIsDirty, confirmLeave, setConfirmLeave, adjusting, setAdjusting,
    lastResumeBeforeAiAdjust, setLastResumeBeforeAiAdjust, adjustWarnings, setAdjustWarnings,
    adjustError, setAdjustError, factOpen, setFactOpen, savedToDocuments, setSavedToDocuments,
    decisions, setDecisions, draftAccepted, setDraftAccepted,
  }
}

export function printFileSizeLabel(sizeBytes: number): string {
  return sizeBytes >= 1024 * 1024
    ? `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
}
