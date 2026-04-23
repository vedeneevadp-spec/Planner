import { HttpError } from '../../bootstrap/http-error.js'
import type {
  CreateProjectCommand,
  ProjectReadContext,
  ProjectWriteContext,
  UpdateProjectCommand,
} from './project.model.js'
import type { ProjectRepository } from './project.repository.js'

export class ProjectService {
  constructor(private readonly repository: ProjectRepository) {}

  listProjects(context: ProjectReadContext) {
    return this.repository.listByWorkspace(context)
  }

  getProject(context: ProjectReadContext, projectId: string) {
    return this.repository.getById(context, projectId)
  }

  createProject(
    context: ProjectWriteContext,
    input: CreateProjectCommand['input'],
  ) {
    assertCanWriteProjects(context)

    return this.repository.create({ context, input })
  }

  updateProject(
    context: ProjectWriteContext,
    projectId: string,
    input: UpdateProjectCommand['input'],
  ) {
    assertCanWriteProjects(context)

    return this.repository.update({
      context,
      input,
      projectId,
    })
  }
}

function assertCanWriteProjects(context: ProjectWriteContext): void {
  if (context.role === 'guest') {
    throw new HttpError(
      403,
      'workspace_write_forbidden',
      'The current workspace role cannot write projects.',
    )
  }
}
