import { describe, expect, it } from "vitest";
import { bootWorld } from "../../test-support/world.js";

describe("task run lifecycle", () => {
  it("records a completed run with running→completed history shape", async () => {
    const w = await bootWorld({ plan: "business", seats: false });
    try {
      const agent = (
        await w.as.owner("POST", "/v1/agents", {
          name: "Runner",
          role: "builder",
          status: "active",
        })
      ).body;
      const task = (
        await w.as.owner("POST", "/v1/tasks", {
          title: "Ship it",
          brief: "Write a one-line plan",
          assigneeAgentId: agent.id,
          status: "assigned",
        })
      ).body;
      const res = await w.as.owner("POST", `/v1/tasks/${task.id}/run`, {});
      expect(res.status).toBe(200);
      expect(res.body.run.status).toBe("completed");
      expect(res.body.run.conversationId).toBeTruthy();

      const listed = await w.as.owner("GET", `/v1/tasks/${task.id}/runs`);
      expect(listed.body.items.some((item: { id: string }) => item.id === res.body.run.id)).toBe(
        true,
      );
      const one = await w.as.owner("GET", `/v1/task-runs/${res.body.run.id}`);
      expect(one.status).toBe(200);
      expect(one.body.run.status).toBe("completed");
    } finally {
      await w.close();
    }
  });

  it("cancelling a non-running run is refused; awaiting_approval can be cancelled", async () => {
    const w = await bootWorld({ plan: "business", seats: false });
    try {
      const agent = (
        await w.as.owner("POST", "/v1/agents", {
          name: "Approver",
          role: "builder",
          status: "active",
        })
      ).body;
      const task = (
        await w.as.owner("POST", "/v1/tasks", {
          title: "Needs OK",
          assigneeAgentId: agent.id,
          status: "assigned",
        })
      ).body;
      const pending = await w.as.owner("POST", `/v1/tasks/${task.id}/run`, {
        requireApproval: true,
      });
      expect(pending.body.run.status).toBe("awaiting_approval");
      const cancelled = await w.as.owner("POST", `/v1/task-runs/${pending.body.run.id}/cancel`, {});
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.run.status).toBe("cancelled");

      const again = await w.as.owner("POST", `/v1/task-runs/${pending.body.run.id}/cancel`, {});
      expect(again.status).toBe(400);
    } finally {
      await w.close();
    }
  });
});

describe("team run orchestration", () => {
  it("fans a brief out to every team member and lists the team run", async () => {
    const w = await bootWorld({ plan: "business", seats: false });
    try {
      const a = (
        await w.as.owner("POST", "/v1/agents", {
          name: "A",
          role: "builder",
          status: "active",
        })
      ).body;
      const b = (
        await w.as.owner("POST", "/v1/agents", {
          name: "B",
          role: "reviewer",
          status: "active",
        })
      ).body;
      const team = (await w.as.owner("POST", "/v1/teams", { name: "Squad" })).body;
      await w.as.owner("POST", `/v1/teams/${team.id}/members`, { agentId: a.id });
      await w.as.owner("POST", `/v1/teams/${team.id}/members`, { agentId: b.id });

      const res = await w.as.owner("POST", `/v1/teams/${team.id}/run`, {
        brief: "Draft the launch checklist",
      });
      expect(res.status).toBe(200);
      expect(res.body.teamRun.status).toBe("completed");
      expect(res.body.runs).toHaveLength(2);
      expect(res.body.runs.every((run: { teamRunId: string }) => run.teamRunId === res.body.teamRun.id)).toBe(
        true,
      );

      const listed = await w.as.owner("GET", "/v1/team-runs");
      expect(listed.body.items.some((item: { id: string }) => item.id === res.body.teamRun.id)).toBe(
        true,
      );
    } finally {
      await w.close();
    }
  });

  it("refuses an empty team and an empty brief", async () => {
    const w = await bootWorld({ plan: "business", seats: false });
    try {
      const team = (await w.as.owner("POST", "/v1/teams", { name: "Empty" })).body;
      expect((await w.as.owner("POST", `/v1/teams/${team.id}/run`, { brief: "x" })).status).toBe(
        400,
      );
      const agent = (
        await w.as.owner("POST", "/v1/agents", {
          name: "Solo",
          role: "builder",
          status: "active",
        })
      ).body;
      await w.as.owner("POST", `/v1/teams/${team.id}/members`, { agentId: agent.id });
      expect((await w.as.owner("POST", `/v1/teams/${team.id}/run`, { brief: "  " })).status).toBe(
        400,
      );
    } finally {
      await w.close();
    }
  });
});
