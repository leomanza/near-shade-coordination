/**
 * Shared utility functions for NEAR Shade Agent coordination.
 */

/**
 * Promise-based sleep utility.
 */
export const sleep = (ms: number): Promise<void> => 
  new Promise(resolve => setTimeout(resolve, ms));

/**
 * Adds random jitter to a base millisecond value.
 * Helpful for avoiding "thundering herd" or retry collisions.
 * @param ms Base milliseconds
 * @param factor Max multiplier for jitter (default 1.0, adds up to 100% of ms)
 */
export const jitter = (ms: number, factor: number = 1.0): number => 
  ms + Math.random() * ms * factor;
