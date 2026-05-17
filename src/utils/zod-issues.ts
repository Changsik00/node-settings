import { z } from "zod";

/** One zod issue distilled to its path + message. */
export interface ZodIssueSummary {
  path: string;
  message: string;
}

/** Flatten a ZodError into a structured list. `path` is dot-joined; the root path renders as `(root)`. */
export function zodIssuesOf(err: z.ZodError): ZodIssueSummary[] {
  return err.errors.map((e) => ({
    path: e.path.join(".") || "(root)",
    message: e.message,
  }));
}

/** Render a ZodError as the indented `  - path: message` list used in error messages. */
export function formatZodIssues(err: z.ZodError): string {
  return zodIssuesOf(err)
    .map((i) => `  - ${i.path}: ${i.message}`)
    .join("\n");
}
