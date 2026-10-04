import { describe, expect, it } from 'vitest';
import { canNodeBeNested, isNetworkNode } from './hardware-config';

describe('non-network add-in components', () => {
  it.each(['cpu', 'pcie'] as const)('%s can be nested and has no network IP', type => {
    expect(canNodeBeNested(type)).toBe(true);
    expect(isNetworkNode(type)).toBe(false);
  });
});
