import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare global {
  namespace JSX {
    interface IntrinsicElements {
      "hl-navbar": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        mode?: string;
      };
    }
  }
}

export {};
