import { HttpError } from '../../bootstrap/http-error.js'
import { canWriteWorkspaceContent } from '../../shared/workspace-access.js'
import type {
  CreateLifeSphereCommand,
  LifeSphereReadContext,
  LifeSphereWriteContext,
  UpdateLifeSphereCommand,
} from './life-sphere.model.js'
import type { LifeSphereRepository } from './life-sphere.repository.js'

export class LifeSphereService {
  constructor(private readonly repository: LifeSphereRepository) {}

  listSpheres(context: LifeSphereReadContext) {
    return this.repository.listByWorkspace(context)
  }

  createSphere(
    context: LifeSphereWriteContext,
    input: CreateLifeSphereCommand['input'],
  ) {
    assertCanWriteLifeSpheres(context)

    return this.repository.create({ context, input })
  }

  updateSphere(
    context: LifeSphereWriteContext,
    sphereId: string,
    input: UpdateLifeSphereCommand['input'],
  ) {
    assertCanWriteLifeSpheres(context)

    return this.repository.update({ context, input, sphereId })
  }

  removeSphere(context: LifeSphereWriteContext, sphereId: string) {
    assertCanWriteLifeSpheres(context)

    return this.repository.remove({ context, sphereId })
  }

  getWeeklyStats(context: LifeSphereReadContext, from: string, to: string) {
    return this.repository.getWeeklyStats({ context, from, to })
  }
}

function assertCanWriteLifeSpheres(context: LifeSphereWriteContext): void {
  if (!canWriteWorkspaceContent(context)) {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace access cannot write life spheres.',
    )
  }
}
