import { onCleanup } from "solid-js";

export function useBodyClass(className: string) {
  const previous = document.body.className;
  document.body.className = className;

  onCleanup(() => {
    document.body.className = previous;
  });
}
