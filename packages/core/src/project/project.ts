/**
 * SphereProject — a shared, Sphere-scoped project (RFC-029; domain
 * capability-catalog `sphere.project.create`).
 *
 * A lightweight collaborative entity: a title, an optional description, a
 * lifecycle state. Distinct from a shared note (which is canonical memory). Pure
 * domain: no I/O, no provider/runtime imports; ids and timestamps are supplied
 * by the caller.
 */

export type ProjectState = "active" | "archived";

export interface SphereProject {
  readonly id: string;
  readonly sphereId: string;
  /** The creating member, or the Sphere itself. */
  readonly ownerId: string;
  readonly ownerType: "member" | "sphere";
  readonly title: string;
  readonly description?: string;
  readonly state: ProjectState;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateProjectInput {
  readonly id: string;
  readonly sphereId: string;
  readonly ownerId: string;
  readonly ownerType: "member" | "sphere";
  readonly title: string;
  readonly description?: string;
  readonly now: string;
}

/** Create a shared Sphere project. A blank title is refused (nothing to name). */
export function createSphereProject(input: CreateProjectInput): SphereProject {
  const title = input.title.trim();
  if (title.length === 0) {
    throw new Error("SphereProject title must not be empty");
  }
  const description = input.description?.trim();
  return {
    id: input.id,
    sphereId: input.sphereId,
    ownerId: input.ownerId,
    ownerType: input.ownerType,
    title,
    ...(description !== undefined && description.length > 0 ? { description } : {}),
    state: "active",
    createdAt: input.now,
    updatedAt: input.now,
  };
}
