export function cookies() {
  const store = new Map<string, string>();
  return {
    get(name: string) {
      const val = store.get(name);
      return val !== undefined ? { name, value: val } : undefined;
    },
    set(nameOrObj: string | { name: string; value: string }, value?: string) {
      if (typeof nameOrObj === "string") {
        store.set(nameOrObj, value || "");
      } else {
        store.set(nameOrObj.name, nameOrObj.value);
      }
    },
    delete(name: string) {
      store.delete(name);
    },
  };
}

export default { cookies };
