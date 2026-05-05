import { generateUuidV7 } from '@planner/contracts'

import type {
  PushDeviceRecord,
  PushDeviceUpsertInput,
  PushNotificationSession,
} from './push-notifications.model.js'
import type { PushNotificationsRepository } from './push-notifications.repository.js'

export class MemoryPushNotificationsRepository implements PushNotificationsRepository {
  private devices = new Map<string, PushDeviceRecord>()

  upsertDevice(
    session: PushNotificationSession,
    input: PushDeviceUpsertInput,
  ): Promise<PushDeviceRecord> {
    const now = new Date().toISOString()
    const conflictingDevice = this.findByToken(input.platform, input.token)

    if (
      conflictingDevice &&
      conflictingDevice.installationId !== input.installationId
    ) {
      this.devices.set(conflictingDevice.id, {
        ...conflictingDevice,
        deletedAt: now,
        updatedAt: now,
        version: conflictingDevice.version + 1,
      })
    }

    const existingDevice = this.findByInstallation(
      input.platform,
      input.installationId,
    )

    if (existingDevice) {
      const nextDevice: PushDeviceRecord = {
        ...existingDevice,
        appVersion: input.appVersion ?? null,
        deletedAt: null,
        deviceName: input.deviceName ?? null,
        lastRegisteredAt: now,
        locale: input.locale ?? null,
        token: input.token,
        updatedAt: now,
        userId: session.actorUserId,
        version: existingDevice.version + 1,
        workspaceId: session.workspaceId,
      }

      this.devices.set(existingDevice.id, nextDevice)

      return Promise.resolve(nextDevice)
    }

    const createdDevice: PushDeviceRecord = {
      appVersion: input.appVersion ?? null,
      createdAt: now,
      deletedAt: null,
      deviceName: input.deviceName ?? null,
      id: generateUuidV7(),
      installationId: input.installationId,
      lastRegisteredAt: now,
      locale: input.locale ?? null,
      platform: input.platform,
      token: input.token,
      updatedAt: now,
      userId: session.actorUserId,
      version: 1,
      workspaceId: session.workspaceId,
    }

    this.devices.set(createdDevice.id, createdDevice)

    return Promise.resolve(createdDevice)
  }

  removeDevice(
    session: PushNotificationSession,
    installationId: string,
  ): Promise<void> {
    const device = this.findByInstallation('android', installationId)

    if (
      !device ||
      device.userId !== session.actorUserId ||
      device.workspaceId !== session.workspaceId ||
      device.deletedAt
    ) {
      return Promise.resolve()
    }

    const now = new Date().toISOString()

    this.devices.set(device.id, {
      ...device,
      deletedAt: now,
      updatedAt: now,
      version: device.version + 1,
    })
    return Promise.resolve()
  }

  listActiveTokens(session: PushNotificationSession): Promise<string[]> {
    return Promise.resolve(
      [...this.devices.values()]
        .filter(
          (device) =>
            device.deletedAt === null &&
            device.userId === session.actorUserId &&
            device.workspaceId === session.workspaceId,
        )
        .sort((left, right) =>
          right.lastRegisteredAt.localeCompare(left.lastRegisteredAt),
        )
        .map((device) => device.token),
    )
  }

  deactivateTokens(tokens: readonly string[]): Promise<void> {
    if (tokens.length === 0) {
      return Promise.resolve()
    }

    const now = new Date().toISOString()
    const invalidTokens = new Set(tokens)

    for (const [id, device] of this.devices.entries()) {
      if (device.deletedAt || !invalidTokens.has(device.token)) {
        continue
      }

      this.devices.set(id, {
        ...device,
        deletedAt: now,
        updatedAt: now,
        version: device.version + 1,
      })
    }
    return Promise.resolve()
  }

  private findByInstallation(
    platform: PushDeviceUpsertInput['platform'],
    installationId: string,
  ): PushDeviceRecord | null {
    return (
      [...this.devices.values()].find(
        (device) =>
          device.platform === platform &&
          device.installationId === installationId,
      ) ?? null
    )
  }

  private findByToken(
    platform: PushDeviceUpsertInput['platform'],
    token: string,
  ): PushDeviceRecord | null {
    return (
      [...this.devices.values()].find(
        (device) => device.platform === platform && device.token === token,
      ) ?? null
    )
  }
}
