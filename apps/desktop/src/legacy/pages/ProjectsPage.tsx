import { type FormEvent, useCallback, useEffect, useState } from "react";
import type { Project } from "@arrab/shared";
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

export function ProjectsPage() {
  const [items, setItems] = useState<Project[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(() => {
    setError(null);
    void arrabApi
      .projects()
      .then((response) => setItems(response.items))
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
      await arrabApi.createProject({
        name,
        description: description.trim() === "" ? null : description,
      });
      setName("");
      setDescription("");
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : "Could not create project");
    } finally {
      setSubmitting(false);
    }
  }

  async function archive(project: Project) {
    setFormError(null);
    try {
      await arrabApi.updateProject(project.id, { status: "archived" });
      load();
    } catch (err: unknown) {
      setFormError(err instanceof ApiRequestError ? err.message : "Could not update project");
    }
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <PageHeader
        title="Projects"
        description="Projects are the containers that hold agents, conversations, knowledge, and activity."
      />
      <CreateForm
        onSubmit={onCreate}
        submitting={submitting}
        error={formError}
        submitLabel="Create project"
      >
        <Field label="Name">
          <input
            className={fieldControlClassName}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Launch Pad"
            required
          />
        </Field>
        <Field label="Description">
          <input
            className={fieldControlClassName}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional"
          />
        </Field>
      </CreateForm>
      {error ? <ApiErrorState message={error} onRetry={load} /> : null}
      {items && items.length === 0 ? (
        <EmptyState
          title="No projects"
          description="Create a project above. This list reads live data from the Arrab API."
        />
      ) : null}
      {items && items.length > 0 ? (
        <EntityList>
          {items.map((project) => (
            <EntityRow
              key={project.id}
              title={project.name}
              meta={`${project.status} · ${project.description ?? "No description"}`}
              action={
                project.status === "active" ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => void archive(project)}>
                    Archive
                  </Button>
                ) : null
              }
            />
          ))}
        </EntityList>
      ) : null}
    </div>
  );
}
