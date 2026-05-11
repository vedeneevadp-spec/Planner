import type {
  LifeSphereRecord,
  LifeSphereUpdateInput,
  NewLifeSphereInput,
  NewProjectInput,
  ProjectRecord,
  ProjectUpdateInput,
} from '@planner/contracts'

export function mapLifeSphereToProjectRecord(
  sphere: LifeSphereRecord,
): ProjectRecord {
  return {
    color: sphere.color,
    createdAt: sphere.createdAt,
    deletedAt: sphere.deletedAt,
    description: sphere.description,
    icon: sphere.icon,
    id: sphere.id,
    status: sphere.isActive ? 'active' : 'archived',
    title: sphere.name,
    updatedAt: sphere.updatedAt,
    version: sphere.version,
    workspaceId: sphere.workspaceId,
  }
}

export function mapNewProjectInputToLifeSphereInput(
  input: NewProjectInput,
): NewLifeSphereInput {
  return {
    ...(input.id ? { id: input.id } : {}),
    color: input.color,
    description: input.description,
    icon: input.icon,
    name: input.title,
  }
}

export function mapProjectUpdateInputToLifeSphereUpdateInput(
  input: ProjectUpdateInput,
): LifeSphereUpdateInput {
  return {
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
    ...(input.title !== undefined ? { name: input.title } : {}),
    ...(input.description !== undefined
      ? { description: input.description }
      : {}),
    ...(input.color !== undefined ? { color: input.color } : {}),
    ...(input.icon !== undefined ? { icon: input.icon } : {}),
  }
}
