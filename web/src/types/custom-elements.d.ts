import type { DetailedHTMLProps, HTMLAttributes } from "react";

type HLNavbarElementProps = DetailedHTMLProps<
  HTMLAttributes<HTMLElement>,
  HTMLElement
> & {
  mode?: string;
};

declare module "react/jsx-runtime" {
  namespace JSX {
    interface IntrinsicElements {
      "hl-navbar": HLNavbarElementProps;
    }
  }
}

export {};
