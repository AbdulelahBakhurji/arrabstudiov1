export type Brand<T, B extends string> = T & { readonly __brand: B };

export type OrganizationId = Brand<string, "OrganizationId">;
export type WorkspaceId = Brand<string, "WorkspaceId">;
export type UserId = Brand<string, "UserId">;
export type ProjectId = Brand<string, "ProjectId">;
export type AgentId = Brand<string, "AgentId">;
export type TeamId = Brand<string, "TeamId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type MemoryId = Brand<string, "MemoryId">;
export type KnowledgeId = Brand<string, "KnowledgeId">;
export type ToolId = Brand<string, "ToolId">;
export type PermissionId = Brand<string, "PermissionId">;
export type ActivityId = Brand<string, "ActivityId">;
export type ModelProviderId = Brand<string, "ModelProviderId">;
export type TaskId = Brand<string, "TaskId">;
export type TaskRunId = Brand<string, "TaskRunId">;
export type SkillId = Brand<string, "SkillId">;
export type ApprovalId = Brand<string, "ApprovalId">;
export type GoalId = Brand<string, "GoalId">;
export type OrgDepartmentId = Brand<string, "OrgDepartmentId">;
export type OrgEmployeeId = Brand<string, "OrgEmployeeId">;
export type FamilyMemberId = Brand<string, "FamilyMemberId">;

export function brandId<T extends string>(value: string): T {
  if (value.trim().length === 0) {
    throw new Error("Identifier must be a non-empty string");
  }
  return value as T;
}
