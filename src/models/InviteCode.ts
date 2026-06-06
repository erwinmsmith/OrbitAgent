import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IInviteCode extends Document {
  codeHash: string;
  label: string;
  isActive: boolean;
  userId?: string;
  deviceIdHash?: string;
  deviceBoundAt?: Date;
  lastUsedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const InviteCodeSchema = new Schema<IInviteCode>(
  {
    codeHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    label: {
      type: String,
      required: true,
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    userId: {
      type: String,
      index: true,
    },
    deviceIdHash: {
      type: String,
      index: true,
    },
    deviceBoundAt: Date,
    lastUsedAt: Date,
  },
  {
    timestamps: true,
    collection: 'invite_codes',
  }
);

export const InviteCodeModel: Model<IInviteCode> = mongoose.model<IInviteCode>(
  'InviteCode',
  InviteCodeSchema
);

export default InviteCodeModel;
