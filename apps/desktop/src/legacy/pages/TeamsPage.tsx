import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Project, Team } from "@arrab/shared";
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
import { arrabApi, ApiRequestError } from "@/lib/api";

export function TeamsPage() {
  const [items, setItems] = useState<Team[] | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void Promise.all([arrabApi.teams(), arrabApi.projects()])
      .then(([teams, projectList]) => {
        setItems(teams.items);
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
      await arrabApi.createTeam({
        name,
        purpose: purpose.trim() === "" ? null : purpose,
        projectId: projectId === "" ? null : projectId,
      });
      setName("");
      setPurpose("");
      setProjectId("");
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : "Could not create team");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        title="AI Teams"
        description="Teams group employees so they can share a project, purpose, and future collaboration rules."
      />
      <CreateForm
        onSubmit={onCreate}
        submitting={submitting}
        error={formError}
        submitLabel="Create team"
      >
        <Field label="Name">
          <input
            className={fieldControlClassName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Core"
            required
          />
        </Field>
        <Field label="Purpose">
          <input
            className={fieldControlClassName}
            value={purpose}
            onChange={(event) => setPurpose(event.target.value)}
            placeholder="Optional"
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
        <EmptyState title="No AI teams" description="Create a team above. Memberships come in a later phase." />
      ) : null}
      {items && items.length > 0 ? (
        <EntityList>
          {items.map((team) => (
            <EntityRow
              key={team.id}
              title={team.name}
              meta={team.purpose ?? "No purpose set"}
            />
          ))}
        </EntityList>
      ) : null}
    </div>
  );
}
