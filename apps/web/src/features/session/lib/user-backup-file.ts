import { Capacitor, registerPlugin } from '@capacitor/core'

import type { DownloadUserBackupResult } from './user-backup-api'

interface PlannerBackupFilesPlugin {
  saveTextFile: (options: {
    fileName: string
    mimeType: string
    text: string
  }) => Promise<{
    displayPath?: string
    fileName: string
    uri?: string
  }>
}

export interface SaveUserBackupFileResult {
  destination: 'android-downloads' | 'browser-download' | 'share-sheet'
  displayPath?: string | undefined
  fileName: string
}

const NativePlannerBackupFiles =
  registerPlugin<PlannerBackupFilesPlugin>('PlannerBackupFiles')

export async function saveUserBackupFile(
  file: DownloadUserBackupResult,
): Promise<SaveUserBackupFileResult> {
  if (isAndroidBackupFilesRuntime()) {
    const result = await NativePlannerBackupFiles.saveTextFile({
      fileName: file.fileName,
      mimeType: 'application/json',
      text: file.text,
    })

    return {
      destination: 'android-downloads',
      displayPath: result.displayPath,
      fileName: result.fileName,
    }
  }

  if (shouldUseShareSheetForBackup() && (await shareUserBackupFile(file))) {
    return {
      destination: 'share-sheet',
      fileName: file.fileName,
    }
  }

  saveUserBackupFileInBrowser(file)

  return {
    destination: 'browser-download',
    fileName: file.fileName,
  }
}

export function isAndroidBackupFilesRuntime(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

export function saveUserBackupFileInBrowser(
  file: DownloadUserBackupResult,
): void {
  const blob = new Blob([file.text], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = file.fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 30_000)
}

async function shareUserBackupFile(
  file: DownloadUserBackupResult,
): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.share !== 'function' ||
    typeof File === 'undefined'
  ) {
    return false
  }

  const backupFile = new File([file.text], file.fileName, {
    type: 'application/json',
  })
  const shareData: ShareData = {
    files: [backupFile],
    title: file.fileName,
  }

  if (
    typeof navigator.canShare === 'function' &&
    !navigator.canShare(shareData)
  ) {
    return false
  }

  await navigator.share(shareData)
  return true
}

function shouldUseShareSheetForBackup(): boolean {
  if (Capacitor.isNativePlatform()) {
    return true
  }

  if (typeof navigator === 'undefined') {
    return false
  }

  return (
    navigator.maxTouchPoints > 0 &&
    /Android|iPad|iPhone|iPod/i.test(navigator.userAgent)
  )
}
