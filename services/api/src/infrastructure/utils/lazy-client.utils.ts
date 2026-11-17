export const createLazyClient = <T extends object>(factory: () => T): T => {
  let instance: T | undefined;

  return new Proxy({} as T, {
    get: (_target, property) => {
      instance ??= factory();
      return Reflect.get(instance, property, instance);
    },
  });
};
