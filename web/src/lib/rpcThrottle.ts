// Shared across public clients in this tab. Never cache a failed identity read.
export function makeRpcThrottle(fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, gapMs = 250, cooldownMs = 60000) {
  let tail: Promise<void> = Promise.resolve(), nextAt = 0, blockedUntil = 0;
  const limited = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const task = tail.then(async () => {
      if (Date.now() < blockedUntil) throw Error("RPC rate limit: 请等待一分钟后重新读取，期间未请求签名。");
      const wait = Math.max(0, nextAt - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      const response = await fetcher(input, init);
      nextAt = Date.now() + gapMs;
      const body = await response.clone().text();
      if (response.status === 429 || /rate limit exceeded|Request exceeds defined limit|too many requests/i.test(body)) {
        blockedUntil = Date.now() + cooldownMs;
        throw Error("RPC rate limit: 请等待一分钟后重新读取，身份未核实前不会请求签名。");
      }
      return response;
    });
    tail = task.then(() => undefined, () => undefined);
    return task;
  };
  return limited;
}
export const throttledRpcFetch = makeRpcThrottle((input, init) => fetch(input, init));
