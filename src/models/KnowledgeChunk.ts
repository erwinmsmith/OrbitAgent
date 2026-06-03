/**
 * KnowledgeChunk — a single section of a KnowledgeDocument, with its
 * embedding vector. We keep the chunks in their own collection so a
 * 10MB doc doesn't bloat a single document and so per-chunk updates
 * (e.g. re-embedding) are cheap.
 *
 * The default embedder is deterministic and small (64-dim BoW hash)
 * so the MVP runs without an external API key. When you swap in a
 * real embedder, the dimension changes — re-embed by overwriting
 * rows in this collection.
 */
import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IKnowledgeChunk extends Document {
  documentId: mongoose.Types.ObjectId;  // → KnowledgeDocument._id
  ownerId: string | null;             // mirror of doc.ownerId (for fast per-user queries)
  scope: 'system' | 'user';
  source: string;                     // mirror of doc.source (for citation)
  sectionTitle: string;               // nearest preceding H1/H2
  text: string;
  embedding: number[];
  index: number;                      // order within the document
  createdAt: Date;
}

const KnowledgeChunkSchema = new Schema<IKnowledgeChunk>(
  {
    documentId: { type: Schema.Types.ObjectId, ref: 'KnowledgeDocument', required: true, index: true },
    ownerId: { type: String, default: null, index: true },
    scope: { type: String, enum: ['system', 'user'], required: true, index: true },
    source: { type: String, required: true, index: true },
    sectionTitle: { type: String, default: '' },
    text: { type: String, required: true },
    embedding: { type: [Number], default: [] },
    index: { type: Number, required: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: 'knowledge_chunks',
  },
);

KnowledgeChunkSchema.index({ ownerId: 1, source: 1, index: 1 });
// Vector search: when a real embedder is wired in, add a
// `2dsphere` or `vectorSearch` index here. The MVP hash embedder
// does cosine in-process, so no special index is needed.

export const KnowledgeChunkModel: Model<IKnowledgeChunk> =
  mongoose.model<IKnowledgeChunk>('KnowledgeChunk', KnowledgeChunkSchema);
