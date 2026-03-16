import { onCleanup, onMount } from "solid-js";

export function useModuleMount(loader: () => Promise<void | (() => void)>) {
  let dispose: void | (() => void);

  onMount(async () => {
    dispose = await loader();
  });

  onCleanup(() => {
    if (typeof dispose === "function") dispose();
  });
}
