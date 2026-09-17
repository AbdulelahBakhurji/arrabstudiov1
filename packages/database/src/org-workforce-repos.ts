import type {
  OrgDepartment,
  OrgEmployeeRecord,
  OrgSecurityEvent,
} from "@arrab/shared";

export interface OrgDepartmentRepository {
  list(): Promise<OrgDepartment[]>;
  getById(id: string): Promise<OrgDepartment | null>;
  create(entity: OrgDepartment): Promise<OrgDepartment>;
  update(entity: OrgDepartment): Promise<OrgDepartment>;
  delete(id: string): Promise<void>;
}

export interface OrgEmployeeRepository {
  list(): Promise<OrgEmployeeRecord[]>;
  getById(id: string): Promise<OrgEmployeeRecord | null>;
  getByEmail(email: string): Promise<OrgEmployeeRecord | null>;
  getBySessionHash(hash: string): Promise<OrgEmployeeRecord | null>;
  create(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord>;
  update(entity: OrgEmployeeRecord): Promise<OrgEmployeeRecord>;
  delete(id: string): Promise<void>;
}

export interface OrgSecurityEventRepository {
  listRecent(limit?: number): Promise<OrgSecurityEvent[]>;
  append(event: OrgSecurityEvent): Promise<OrgSecurityEvent>;
}
