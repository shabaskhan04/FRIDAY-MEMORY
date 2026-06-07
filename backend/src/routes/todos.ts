import type { FastifyInstance } from "fastify";
import { createServiceClient } from "../lib/supabase";

interface TodoPatchBody {
  id: string;
  status: "pending" | "done";
}

export async function todosRoutes(app: FastifyInstance): Promise<void> {
  app.get("/todos", async (_request, reply) => {
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("todo_tasks")
        .select("id, raw_ledger_id, task_description, status, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[todos] fetch error:", error);
        return reply.code(500).send({ error: "Failed to fetch todos.", detail: error.message });
      }

      return reply.send({ todos: data ?? [] });
    } catch (err) {
      console.error("[todos] GET unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });

  app.patch<{ Body: TodoPatchBody }>("/todos", async (request, reply) => {
    const { id, status } = request.body;

    if (!id || !status) {
      return reply.code(400).send({ error: "id and status are required." });
    }

    if (!["pending", "done"].includes(status)) {
      return reply.code(400).send({ error: "status must be 'pending' or 'done'." });
    }

    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("todo_tasks")
        .update({ status })
        .eq("id", id)
        .select("id, status");

      if (error) {
        return reply.code(500).send({ error: "Failed to update todo.", detail: error.message });
      }

      if (!data || data.length === 0) {
        return reply.code(404).send({ error: "No todo found with that id." });
      }

      return reply.send({ todo: data[0] });
    } catch (err) {
      console.error("[todos] PATCH unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });
}
