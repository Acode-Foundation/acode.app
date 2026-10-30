import { whenNear } from '../../client/lib/whenNear';

it('defers work, runs once, and respects navigation cleanup', () => {
  let report;
  const disconnect = vi.fn();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback) {
        report = callback;
      }
      observe() {}
      disconnect = disconnect;
    },
  );
  const controller = new AbortController();
  const callback = vi.fn();
  whenNear({}, callback, controller.signal);
  report([{ isIntersecting: false }]);
  expect(callback).not.toHaveBeenCalled();
  controller.abort();
  report([{ isIntersecting: true }]);
  expect(callback).not.toHaveBeenCalled();
  expect(disconnect).toHaveBeenCalled();
  whenNear({}, callback, new AbortController().signal);
  report([{ isIntersecting: true }]);
  report([{ isIntersecting: true }]);
  expect(callback).toHaveBeenCalledOnce();
  vi.unstubAllGlobals();
});
