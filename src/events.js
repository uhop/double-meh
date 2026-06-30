export const installEvents = io => {
  const listeners = {};
  io.on = (event, fn) => {
    (listeners[event] = listeners[event] || []).push(fn);
    return io;
  };
  io.off = (event, fn) => {
    const fns = listeners[event];
    if (fns) {
      const index = fns.indexOf(fn);
      if (index >= 0) fns.splice(index, 1);
    }
    return io;
  };
  io.emit = (event, ...args) => {
    const fns = listeners[event];
    if (fns) for (const fn of fns.slice()) fn(...args);
    return io;
  };
  return io;
};
