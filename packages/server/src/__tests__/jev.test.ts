import { describe, expect, it, vi } from 'vitest';
import { chooseJev } from '../jev.js';
const config = { apiKey: 'test-secret', model: 'jev-latest', timeoutMs: 100 };
const choices = [{ type: 'passBid' }, { type: 'bid', amount: 12 }];

describe('Jev decisions', () => {
  it('sends typed choices and maps the answer to an exact supplied action', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ answers: { move: { choice: 'move_1' } } })));
    expect(await chooseJev(config, { money: 20 }, choices, fetcher)).toEqual(choices[1]);
    const request = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(request[1].body as string)).toMatchObject({ model: 'jev-latest', questions: { move: { type: 'choice' } } });
  });
  it('rejects unknown choices, errors and malformed responses without retries', async () => {
    for (const response of [new Response('{}'), new Response('{'), new Response('', { status: 429 }), new Response('{"answers":{"move":{"choice":"move_99"}}}')]) {
      const fetcher = vi.fn(async () => response);
      expect(await chooseJev(config, {}, choices, fetcher)).toBeNull();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    expect(await chooseJev(config, {}, choices, async () => { throw new Error('timeout'); })).toBeNull();
  });
  it('does not spend a request on a forced move', async () => {
    const fetcher = vi.fn();
    expect(await chooseJev(config, {}, [choices[0]], fetcher)).toEqual(choices[0]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
