/** Helpers for the tests of the schemas Claude fills in, and of the readers that send them. */
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { aDocumentOfKind, SEEN_KINDS, type DocumentKindName } from "../rules/document-kind";
import { KIND_VALUE, type ReadOptions, type ReadResult } from "./read";

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

/**
 * A stand-in for the Claude API. It records what it was sent and answers with
 * `answer` as the message's text (an object is sent as its JSON). `more`
 * changes the message around it, such as its stop reason.
 */
export function answeringClient(answer: unknown, more: object = {}) {
  const sent: Anthropic.MessageCreateParams[] = [];
  const text = typeof answer === "string" ? answer : JSON.stringify(answer);
  const client = {
    messages: {
      create: async (params: Anthropic.MessageCreateParams) => {
        sent.push(params);
        return {
          stop_reason: "end_turn",
          usage: { input_tokens: 6000, output_tokens: 500 },
          content: [{ type: "text", text }],
          ...more,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, sent };
}

/** A file every reader takes: the first bytes of a JPEG. */
export const JPEG_FILE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

/**
 * The tests every reader shares: it reads its own kind of document, and a
 * file of any other kind comes back refused, with the kind it is and no values.
 */
export function describeKindCheck<T>(reader: {
  name: string;
  expects: DocumentKindName;
  read(file: Uint8Array, options: ReadOptions): Promise<ReadResult<T>>;
  /** What Claude fills in for the sample document, without the kind. */
  wire: object;
  /** The values that answer is read as. */
  values: unknown;
}) {
  describe(`${reader.name}: what the document is`, () => {
    const others = SEEN_KINDS.filter((kind) => kind !== reader.expects);

    it(`reads ${aDocumentOfKind(reader.expects)} that is named as one`, async () => {
      const { client } = answeringClient({ [KIND_VALUE]: reader.expects, ...reader.wire });
      expect(await reader.read(JPEG_FILE, { model: "haiku", client })).toMatchObject({ ok: true, values: reader.values });
    });

    it.each(others)("refuses a file named as %s, and returns no values from it", async (seen) => {
      const { client } = answeringClient({ [KIND_VALUE]: seen, ...reader.wire });
      const result = await reader.read(JPEG_FILE, { model: "haiku", client });
      expect(result).toMatchObject({ ok: false, wrongKind: seen, usage: { input_tokens: 6000, output_tokens: 500 } });
      expect(result).not.toHaveProperty("values");
    });

    it("refuses it as the wrong kind even when nothing else in the answer fits", async () => {
      const { client } = answeringClient({ [KIND_VALUE]: others[0] });
      expect(await reader.read(JPEG_FILE, { model: "haiku", client })).toMatchObject({ ok: false, wrongKind: others[0] });
    });

    it("asks for the kind before any other value, and says which kind it expects", async () => {
      const { client, sent } = answeringClient({ [KIND_VALUE]: reader.expects, ...reader.wire });
      await reader.read(JPEG_FILE, { model: "haiku", client });

      const schema = sent[0].output_config?.format?.schema as { properties: Record<string, { description: string }>; required: string[] };
      expect(Object.keys(schema.properties)[0]).toBe(KIND_VALUE);
      // The SDK sends a list of choices inside the value's description.
      expect(schema.properties[KIND_VALUE].description).toContain(`enum: ${JSON.stringify(SEEN_KINDS)}`);
      for (const kind of SEEN_KINDS) expect(schema.properties[KIND_VALUE].description).toContain(`\n${kind}: `);
      expect(schema.required).toContain(KIND_VALUE);
      expect(schema.properties[KIND_VALUE].description).toContain(`If it is not ${aDocumentOfKind(reader.expects)}, don't read it as one`);
      // Nothing about the kind is added to the reader's own prompt.
      expect(String(sent[0].system)).not.toContain(KIND_VALUE);
    });
  });
}
