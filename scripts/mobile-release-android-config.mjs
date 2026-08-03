import { readFile } from 'node:fs/promises'

export async function assertAndroidFirebaseConfig({ applicationId, filePath }) {
  let rawConfig

  try {
    rawConfig = await readFile(filePath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Android Firebase config was not found: ${filePath}. Add google-services.json before building a release artifact.`,
      )
    }

    throw error
  }

  let config

  try {
    config = JSON.parse(rawConfig)
  } catch {
    throw new Error(`Android Firebase config is not valid JSON: ${filePath}.`)
  }

  const clients = Array.isArray(config?.client) ? config.client : []
  const matchingClient = clients.find(
    (client) =>
      client?.client_info?.android_client_info?.package_name === applicationId,
  )

  if (!matchingClient) {
    throw new Error(
      `Android Firebase config does not contain a client for ${applicationId}: ${filePath}.`,
    )
  }

  const hasProjectInfo =
    typeof config?.project_info?.project_id === 'string' &&
    config.project_info.project_id.trim().length > 0
  const hasAppId =
    typeof matchingClient?.client_info?.mobilesdk_app_id === 'string' &&
    matchingClient.client_info.mobilesdk_app_id.trim().length > 0
  const hasApiKey = matchingClient.api_key?.some(
    (entry) =>
      typeof entry?.current_key === 'string' &&
      entry.current_key.trim().length > 0,
  )

  if (!hasProjectInfo || !hasAppId || !hasApiKey) {
    throw new Error(
      `Android Firebase config is incomplete for ${applicationId}: ${filePath}.`,
    )
  }
}
