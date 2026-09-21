import { describe, expect, it } from 'vitest';
import { parseAction } from '../src/prompt.js';

describe('parseAction — tolerant action extraction', () => {
  it('parses a fenced json block', () => {
    const text = 'Here is my choice:\n```json\n{"tool":"do_task","input":{"taskId":"label-batch"},"rationale":"earn"}\n```';
    const a = parseAction(text);
    expect(a?.tool).toBe('do_task');
    expect(a?.input.taskId).toBe('label-batch');
    expect(a?.rationale).toBe('earn');
  });

  it('parses a bare object with surrounding prose', () => {
    const text = 'I will do a task. {"tool":"do_task","input":{}} Thanks.';
    expect(parseAction(text)?.tool).toBe('do_task');
  });

  it('handles nested braces in the object', () => {
    const text = '{"tool":"reflect","input":{"soul":"# SOUL\\n{notes}"},"rationale":"x"}';
    const a = parseAction(text);
    expect(a?.tool).toBe('reflect');
    expect(typeof a?.input.soul).toBe('string');
  });

  it('returns null when there is no object (loop falls back to rest)', () => {
    expect(parseAction('no json here at all')).toBeNull();
  });

  it('returns null when tool is missing', () => {
    expect(parseAction('{"input":{}}')).toBeNull();
  });

  it('defaults input to an empty object when absent', () => {
    const a = parseAction('{"tool":"rest"}');
    expect(a?.tool).toBe('rest');
    expect(a?.input).toEqual({});
  });
});
