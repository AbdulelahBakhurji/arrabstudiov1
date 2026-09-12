import { type FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Agent, Project } from "@arrab/shared";
import {
  ApiErrorState,
  CreateForm,
  EmptyState,
  EntityList,
  EntityRow,
  Field,
  PageHeader,
  fieldControlClassName,
} from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { arrabApi, ApiRequestError } from "@/lib/api";

export function EmployeesPage() {
  const [items, setItems] = useState<Agent[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void Promise.all([arrabApi.agents(), arrabApi.projects()])
      .then(([agents, projectList]) => {
        setItems(agents.items);
        setProjects(projectList.items.filter((project) => project.status === "active"));
      })
      .catch((err: unknown) => {
        setItems(null);
        setError(err instanceof ApiRequestError ? err.message : "Cannot reach the Arrab API");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      await arrabApi.createAgent({
        name,
        role,
        projectId: projectId === "" ? null : projectId,
        status: "active",
      });
      setName("");
      setRole("");
      setProjectId("");
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : "Could not create employee");
    } finally {
      setSubmitting(false);
    }
  }

  async function pause(agent: Agent) {
    setFormError(null);
    try {
      await arrabApi.updateAgent(agent.id, { status: "paused" });
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : "Could not update employee");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        title="AI Employees"
        description="Each employee is a specialized agent with a role, optional project assignment, and conversations through the Arrab API."
      />
      <CreateForm
        onSubmit={onCreate}
        submitting={submitting}
        error={formError}
        submitLabel="Create employee"
      >
        <Field label="Name">
          <input
            className={fieldControlClassName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Researcher"
            required
          />
        </Field>
        <Field label="Role">
          <input
            className={fieldControlClassName}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            placeholder="research"
            required
          />
        </Field>
        <Field label="Project">
          <select
            className={fieldControlClassName}
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Unassigned</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
      </CreateForm>
      {error ? <ApiErrorState message={error} onRetry={load} /> : null}
      {items && items.length === 0 ? (
        <EmptyState
          title="No AI employees"
          description="Create an employee above. Agents are stored by the Arrab API."
        />
      ) : null}
      {items && items.length > 0 ? (
        <EntityList>
          {items.map((agent) => (
            <EntityRow
              key={agent.id}
              title={agent.name}
              meta={`${agent.role} · ${agent.status}${agent.projectId ? ` · project ${agent.projectId}` : ""}`}
              action={
                <div className="flex items-center gap-2">
                  <Link
                    to={`/conversations?agentId=${agent.id}`}
                    className="inline-flex h-8 items-center rounded-md border border-white/15 px-3 text-xs text-white hover:bg-white/5"
                  >
                    Talk
                  </Link>
                  {agent.status === "active" ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void pause(agent)}
                    >
                      Pause
                    </Button>
                  ) : null}
                </div>
              }
            />
          ))}
        </EntityList>
      ) : null}
    </div>
  );
}
