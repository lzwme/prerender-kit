import { describe, expect, it } from 'vitest';
import { parseCliNumber } from '../src/cli.js';

describe('parseCliNumber', () => {
  it('应正确解析 0 与其它数值', () => {
    expect(parseCliNumber('0')).toBe(0);
    expect(parseCliNumber(0)).toBe(0);
    expect(parseCliNumber('60')).toBe(60);
    expect(parseCliNumber('')).toBeUndefined();
    expect(parseCliNumber(undefined)).toBeUndefined();
    expect(parseCliNumber('abc')).toBeUndefined();
  });
});
