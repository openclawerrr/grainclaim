/** Helpers for the tests of the schemas Claude fills in. */
import { z } from "zod";

interface SchemaNode {
  type?: unknown;
  anyOf?: SchemaNode[];
  description?: string;
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
}

function visit(node: SchemaNode, path: string, see: (path: string, node: SchemaNode) => void): void {
  for (const [name, property] of Object.entries(node.properties ?? {})) {
    const at = path ? `${path}.${name}` : name;
    see(at, property);
    visit(property, at, see);
  }
  if (node.items) visit(node.items, `${path}[]`, see);
  for (const option of node.anyOf ?? []) visit(option, path, see);
}

/** Every value in a schema as it is sent to Claude, nested ones included, with its path. */
export function sentValues(schema: z.ZodType): { path: string; nullable: boolean; description?: string }[] {
  const values: { path: string; nullable: boolean; description?: string }[] = [];
  visit(z.toJSONSchema(schema) as SchemaNode, "", (path, node) => {
    values.push({ path, nullable: Boolean(node.anyOf) || Array.isArray(node.type), description: node.description });
  });
  return values;
}
