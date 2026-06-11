import { TemporaryMemory } from '../../src/core/memory/TemporaryMemory';
import { getRedisClient } from '../../src/services/database';

describe('TemporaryMemory', () => {
  it('trims Redis stream as a sliding window of maxPairs * 2 messages', async () => {
    const redis = {
      xadd: jest.fn(),
      expire: jest.fn(),
      sadd: jest.fn(),
      xlen: jest.fn().mockResolvedValueOnce(101),
      xtrim: jest.fn(),
    };
    (getRedisClient as jest.Mock).mockReturnValue(redis);

    const memory = new TemporaryMemory({ maxPairs: 50, ttl: 86400 });
    await memory.addMessage('sess_test', {
      userId: 'user_test',
      sessionId: 'sess_test',
      role: 'user',
      content: 'hello',
    });

    expect(redis.xtrim).toHaveBeenCalledWith('memory:temp:sess_test', 'MAXLEN', 100);
  });
});
