// Shared across public clients in this tab. Never cache a failed identity read.
export function makeRpcThrottle(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, gapMs = 250, cooldownMs = 60000) {
  let tail: Promise<void> = Promise.resolve(), nextAt = 0, blockedUntil = 0;
  const limited = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const task = tail.then(async () => {
      if (Date.now() < blockedUntil) throw Error("RPC rate limit: Wait one minute before reading again. No signature requested.");
      const wait = Math.max(0, nextAt - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const response = await fetcher(input, init);
      nextAt = Date.now() + gapMs;
      const body = await response.clone().text();
      if (response.status === 429 || /rate limit exceeded|Request exceeds defined limit|too many requests/i.test(body)) {
        blockedUntil = Date.now() + cooldownMs;
        throw Error("RPC rate limit: Wait one minute before reading again. No signature will be requested until identity is verified.");
      }
      return response;
    });
    tail = task.then(() => undefined, () => undefined);
    return task;
  };
  return limited;
}
export const throttledRpcFetch = makeRpcThrottle((input, init) => fetch(input, init));
