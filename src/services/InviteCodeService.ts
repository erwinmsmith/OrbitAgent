import crypto from 'crypto';
import { InviteCodeModel, IInviteCode } from '../models/InviteCode';
import { UserModel, IUser } from '../models/User';
import { SEED_INVITE_CODES } from '../data/inviteCodes';
import { logger } from '../utils/logger';

export function normalizeInviteCode(code: string): string {
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function hashInviteCode(code: string): string {
  return crypto.createHash('sha256').update(normalizeInviteCode(code)).digest('hex');
}

export function normalizeDeviceId(deviceId: string): string {
  return deviceId.trim();
}

export function hashDeviceId(deviceId: string): string {
  return crypto.createHash('sha256').update(normalizeDeviceId(deviceId)).digest('hex');
}

export type InviteCodeAuthFailure = 'invalid' | 'device_mismatch';

export interface InviteCodeAuthSuccess {
  ok: true;
  invite: IInviteCode;
  user: IUser;
}

export interface InviteCodeAuthError {
  ok: false;
  reason: InviteCodeAuthFailure;
}

export type InviteCodeAuthResult = InviteCodeAuthSuccess | InviteCodeAuthError;

function inviteUsername(code: string): string {
  return `invite_${normalizeInviteCode(code).toLowerCase().replace(/[^a-z0-9]/g, '')}`;
}

function inviteEmail(code: string): string {
  return `${inviteUsername(code)}@invite.orbit.local`;
}

export async function seedInviteCodes(): Promise<void> {
  const ops = SEED_INVITE_CODES.map(invite => ({
    updateOne: {
      filter: { codeHash: invite.codeHash },
      update: {
        $setOnInsert: {
          codeHash: invite.codeHash,
          label: invite.label,
          isActive: true,
        },
      },
      upsert: true,
    },
  }));

  if (ops.length === 0) return;

  const result = await InviteCodeModel.bulkWrite(ops, { ordered: false });
  logger.info(`Invite codes seeded: ${result.upsertedCount} inserted, ${result.modifiedCount} modified`);
}

async function ensureInviteUser(invite: IInviteCode, code: string): Promise<IUser> {
  if (invite.userId) {
    const existing = await UserModel.findById(invite.userId);
    if (existing) return existing;
  }

  const username = inviteUsername(code);
  const email = inviteEmail(code);
  const existingByUsername = await UserModel.findOne({ username });
  if (existingByUsername) {
    invite.userId = existingByUsername.id;
    await invite.save();
    return existingByUsername;
  }

  const user = await UserModel.create({
    username,
    email,
    password: crypto.randomBytes(32).toString('hex'),
    displayName: invite.label,
    preferences: {
      authMethod: 'invite-code',
      inviteLabel: invite.label,
    },
  });

  invite.userId = user.id;
  await invite.save();
  return user;
}

export async function authenticateInviteCode(
  code: string,
  deviceId: string,
): Promise<InviteCodeAuthResult> {
  const normalized = normalizeInviteCode(code);
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalized || !normalizedDeviceId) return { ok: false, reason: 'invalid' };

  const invite = await InviteCodeModel.findOne({
    codeHash: hashInviteCode(normalized),
    isActive: true,
  });

  if (!invite) return { ok: false, reason: 'invalid' };

  const deviceIdHash = hashDeviceId(normalizedDeviceId);
  if (invite.deviceIdHash && invite.deviceIdHash !== deviceIdHash) {
    return { ok: false, reason: 'device_mismatch' };
  }
  if (!invite.deviceIdHash) {
    invite.deviceIdHash = deviceIdHash;
    invite.deviceBoundAt = new Date();
  }

  const user = await ensureInviteUser(invite, normalized);
  invite.lastUsedAt = new Date();
  await invite.save();

  return { ok: true, invite, user };
}
