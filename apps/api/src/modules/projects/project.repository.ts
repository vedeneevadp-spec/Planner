import type {
  CreateProjectCommand,
  ProjectReadContext,
  StoredProjectRecord,
  UpdateProjectCommand,
} from './project.model.js'

export interface ProjectRepository {
  listByWorkspace(context: ProjectReadContext): Promise<StoredProjectRecord[]>
  getById(
    context: ProjectReadContext,
    projectId: string,
  ): Promise<StoredProjectRecord>
  create(command: CreateProjectCommand): Promise<StoredProjectRecord>
  update(command: UpdateProjectCommand): Promise<StoredProjectRecord>
}
