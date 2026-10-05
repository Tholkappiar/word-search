import { z } from "zod";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export type InspectorMetadata = {
  label?: string;
  group?: string;
  editable?: boolean;
  min?: number;
  max?: number;
  step?: number;
};

export type InspectorField = InspectorMetadata & {
  path: string;
  label: string;
  type: "number" | "string" | "boolean" | "null" | "array" | "object";
  value: JsonValue;
  editable: boolean;
};

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);

/** Snapshots deliberately accept JSON data only, and never retain caller references. */
export function cloneGameData<T>(value: T, path = "$", ancestors = new Set<object>()): T {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || value === null) throw new Error(`${path} must contain finite, serializable JSON data`);
  if (ancestors.has(value)) throw new Error(`${path} contains a circular reference`);
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} must be a plain object or array`);
  }
  ancestors.add(value);
  let copy: unknown;
  if (Array.isArray(value)) {
    copy = value.map((item, index) => cloneGameData(item, `${path}[${index}]`, ancestors));
  } else {
    const object: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (forbiddenKeys.has(key)) throw new Error(`${path}.${key} is not a safe state key`);
      object[key] = cloneGameData(item, `${path}.${key}`, ancestors);
    }
    copy = object;
  }
  ancestors.delete(value);
  return copy as T;
}

function checkRemovedKeys(input: unknown, output: unknown, path = "$"): void {
  if (input === null || typeof input !== "object" || output === null || typeof output !== "object") return;
  for (const key of Object.keys(input)) {
    if (key.includes(".") || key.includes("/")) throw new Error(`${path}.${key} contains a reserved state-path character`);
    if (!Object.prototype.hasOwnProperty.call(output, key)) throw new Error(`${path}.${key} is not registered in the state schema`);
    checkRemovedKeys((input as Record<string, unknown>)[key], (output as Record<string, unknown>)[key], `${path}.${key}`);
  }
}

export function parseGameData<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, rejectRemovedKeys = true): T {
  const original = cloneGameData(input);
  const parsed = schema.parse(original);
  if (rejectRemovedKeys) checkRemovedKeys(original, parsed);
  return cloneGameData(parsed);
}

export function gamePathSegments(path: string): string[] {
  const parts = path.startsWith("/") ? path.slice(1).split("/") : path.split(".");
  if (!path || parts.some((part) => !part || forbiddenKeys.has(part))) throw new Error(`Invalid state path: ${path}`);
  return parts;
}

export function readGameStatePath(state: unknown, path: string): unknown {
  if (path === "") return cloneGameData(state);
  let current = state;
  for (const part of gamePathSegments(path)) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) {
      throw new Error(`State path does not exist: ${path}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  return cloneGameData(current);
}

export function writeGameStatePath(state: unknown, path: string, value: unknown): void {
  const parts = gamePathSegments(path);
  let current = state;
  for (const part of parts.slice(0, -1)) {
    if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) throw new Error(`State path does not exist: ${path}`);
    current = (current as Record<string, unknown>)[part];
  }
  const last = parts[parts.length - 1]!;
  if (current === null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, last)) throw new Error(`State path does not exist: ${path}`);
  (current as Record<string, unknown>)[last] = cloneGameData(value);
}

export function inspectorMetadataFor(metadata: Record<string, InspectorMetadata>, path: string): InspectorMetadata {
  const wildcard = path.split(".").map((part) => /^\d+$/.test(part) ? "*" : part).join(".");
  return metadata[path] ?? metadata[`/${path.replaceAll(".", "/")}`] ?? metadata[wildcard] ?? {};
}

/** Schema-parsed state is the registry: newly present optional fields/entities appear automatically. */
export function discoverInspectorFields(state: unknown, metadata: Record<string, InspectorMetadata> = {}): InspectorField[] {
  const fields: InspectorField[] = [];
  const walk = (value: unknown, path: string) => {
    const options = inspectorMetadataFor(metadata, path);
    const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    if (path && (type !== "object" && type !== "array" || options.editable || Array.isArray(value) && value.length === 0)) {
      fields.push({ ...options, path, label: options.label ?? path, type: type as InspectorField["type"], value: cloneGameData(value) as JsonValue, editable: options.editable === true });
    }
    if (value !== null && typeof value === "object" && !options.editable) {
      for (const [key, child] of Object.entries(value)) walk(child, path ? `${path}.${key}` : key);
    }
  };
  walk(state, "");
  return fields;
}

export function canonicalGameStateJson(state: unknown): string {
  const canonical = (value: unknown): string => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
      return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    }
    return JSON.stringify(value);
  };
  return canonical(cloneGameData(state));
}

export function canonicalGameStateHash(state: unknown): string {
  const text = canonicalGameStateJson(state);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return (hash >>> 0).toString(16).padStart(8, "0");
}
