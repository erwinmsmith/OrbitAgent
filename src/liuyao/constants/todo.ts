/**
 * Helper for surfacing the "data still missing" condition. Every skill
 * that depends on an external hard-coded table throws a `TodoError`
 * pointing at docs/liuyao/KNOWLEDGE_NEEDED.md until the user supplies
 * the data. This makes "what still needs to be looked up?" obvious
 * without silently returning garbage.
 */
export class TodoError extends Error {
  readonly section: string;
  constructor(section: string, message: string) {
    super(`TODO[${section}]: ${message}\n  → see docs/liuyao/KNOWLEDGE_NEEDED.md §${section}`);
    this.name = 'TodoError';
    this.section = section;
  }
}

/** Convenience: throw a TodoError for the given KNOWLEDGE_NEEDED section. */
export function todo(section: string, message: string): never {
  throw new TodoError(section, message);
}
