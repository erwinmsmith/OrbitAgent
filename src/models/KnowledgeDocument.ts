/**
 * KnowledgeDocument — a single markdown document in the RAG
 * knowledge base. Each document is owned by a user (or is
 * system-wide when ownerId is null), chunked at upload time, and
 * stored in KnowledgeChunk alongside its embedding.
 *
 * Per-user isolation: when fetching chunks for the agent, the
 * RAG index query unions system documents (ownerId: null) and
 * the requesting user's own uploads. Other users' private uploads
 * are NEVER included.
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export type KnowledgeScope = 'system' | 'user';

export interface IKnowledgeDocument extends Document {
  ownerId: string | null;          // null = system-wide (ships with repo)
  scope: KnowledgeScope;            // 'system' for built-ins, 'user' for uploads
  /** Stable source key used by the RAG index. Format:
   *   system: 'docs/base_knowledge/<file>.md'
   *   user:   'user:<userId>/<filename>' */
  source: string;
  /** Original filename, e.g. "我的卦例.md". */
  filename: string;
  /** Optional short title (first H1 / first non-empty line). */
  title: string;
  /** Raw text body. Useful for re-embedding or auditing. */
  body: string;
  /** Embedder key used to embed this doc — lets us invalidate +
   *  rebuild when the embedder changes. */
  embedderKey: string;
  /** SHA-256 of the body at the time of the last successful embed.
   *  Used by the bootstrap's content-hash cache to skip re-embedding
   *  files that haven't changed since the last run. */
  contentHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeDocumentSchema = new Schema<IKnowledgeDocument>(
  {
    ownerId: { type: String, default: null, index: true },
    scope: { type: String, enum: ['system', 'user'], required: true, index: true },
    source: { type: String, required: true, unique: true },
    filename: { type: String, required: true },
    title: { type: String, default: '' },
    body: { type: String, required: true },
    embedderKey: { type: String, required: true },
    contentHash: { type: String, default: null },
  },
  {
    timestamps: true,
    collection: 'knowledge_documents',
  },
);

KnowledgeDocumentSchema.index({ ownerId: 1, scope: 1 });

export const KnowledgeDocumentModel: Model<IKnowledgeDocument> =
  mongoose.model<IKnowledgeDocument>('KnowledgeDocument', KnowledgeDocumentSchema);
