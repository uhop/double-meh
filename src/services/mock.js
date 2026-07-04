// @ts-self-types="./mock.d.ts"
import {canonicalUrl} from '../key.js';

const toResponse = async value => {
  const resolved = await value;
  if (resolved instanceof Response) return resolved;
  return new Response(JSON.stringify(resolved === undefined ? null : resolved), {
    status: 200,
    headers: {'content-type': 'application/json'}
  });
};

export const installMock = io => {
  const exact = new Map();
  const rules = [];

  const findMatch = (request, ctx) => {
    const direct = exact.get(canonicalUrl(request.url));
    if (direct) return direct;
    for (const rule of rules) if (rule.match(request.url, request, ctx)) return rule.callback;
    return undefined;
  };

  const handle = (request, ctx) => {
    if (ctx.options.mock === false) return null;
    const callback = findMatch(request, ctx);
    return callback ? toResponse(callback(request, ctx)) : null;
  };

  const service = {name: 'mock', priority: 20, handle};

  const setRule = (matcher, match, callback) => {
    const index = rules.findIndex(rule => rule.matcher === matcher);
    if (index >= 0) rules.splice(index, 1);
    if (callback) rules.push({matcher, match, callback});
  };

  io.mock = (matcher, callback) => {
    if (typeof matcher === 'string') {
      if (matcher.endsWith('*')) {
        const prefix = matcher.slice(0, -1);
        setRule(matcher, url => url.startsWith(prefix), callback);
      } else if (callback) exact.set(canonicalUrl(matcher), callback);
      else exact.delete(canonicalUrl(matcher));
    } else if (matcher instanceof RegExp) {
      setRule(matcher, url => matcher.test(url), callback);
    } else if (typeof matcher === 'function') {
      setRule(matcher, (_url, request, ctx) => matcher(request, ctx), callback);
    }
    if (callback && !io.mock.isActive) io.mock.attach();
    return io;
  };

  io.mock.exact = exact;
  io.mock.isActive = false;
  io.mock.attach = () => {
    io.attach(service);
    io.mock.isActive = true;
    return io;
  };
  io.mock.detach = () => {
    io.detach('mock');
    io.mock.isActive = false;
    return io;
  };
  io.mock.clear = () => {
    exact.clear();
    rules.length = 0;
    io.mock.detach();
    return io;
  };

  return io.mock;
};
