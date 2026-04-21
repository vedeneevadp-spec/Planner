import {
  ProjectNotFoundError,
  ProjectVersionConflictError,
} from './project.errors.js'
import type {
  CreateProjectCommand,
  ProjectReadContext,
  StoredProjectRecord,
  UpdateProjectCommand,
} from './project.model.js'
import type { ProjectRepository } from './project.repository.js'
import {
  applyProjectUpdate,
  createStoredProjectRecord,
  sortStoredProjects,
} from './project.shared.js'

export class MemoryProjectRepository implements ProjectRepository {
  private readonly projects = new Map<string, StoredProjectRecord>()

  listByWorkspace(context: ProjectReadContext): Promise<StoredProjectRecord[]> {
    const projects = [...this.projects.values()].filter(
      (project) =>
        project.workspaceId === context.workspaceId &&
        project.deletedAt === null &&
        project.status === 'active',
    )

    return Promise.resolve(sortStoredProjects(projects))
  }

  getById(
    context: ProjectReadContext,
    projectId: string,
  ): Promise<StoredProjectRecord> {
    return Promise.resolve(
      this.getProjectOrThrow(projectId, context.workspaceId),
    )
  }

  create(command: CreateProjectCommand): Promise<StoredProjectRecord> {
    const existingProject = command.input.id
      ? this.projects.get(command.input.id)
      : undefined

    if (
      existingProject &&
      existingProject.workspaceId === command.context.workspaceId &&
      existingProject.deletedAt === null
    ) {
      return Promise.resolve(existingProject)
    }

    const project = createStoredProjectRecord(command.input, {
      workspaceId: command.context.workspaceId,
    })

    this.projects.set(project.id, project)

    return Promise.resolve(project)
  }

  update(command: UpdateProjectCommand): Promise<StoredProjectRecord> {
    const project = this.getProjectOrThrow(
      command.projectId,
      command.context.workspaceId,
    )

    if (
      command.input.expectedVersion !== undefined &&
      project.version !== command.input.expectedVersion
    ) {
      throw new ProjectVersionConflictError(
        project.id,
        command.input.expectedVersion,
        project.version,
      )
    }

    const nextProject = applyProjectUpdate(project, command.input)

    this.projects.set(nextProject.id, nextProject)

    return Promise.resolve(nextProject)
  }

  private getProjectOrThrow(
    projectId: string,
    workspaceId: string,
  ): StoredProjectRecord {
    const project = this.projects.get(projectId)

    if (
      !project ||
      project.workspaceId !== workspaceId ||
      project.deletedAt !== null ||
      project.status !== 'active'
    ) {
      throw new ProjectNotFoundError(projectId)
    }

    return project
  }
}
