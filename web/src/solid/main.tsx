import { render } from "solid-js/web";

import "@/index.css";
import "../../../styles.css";
import "../../../wallet.css";
import "../../../market-flow.css";

import { App } from "./App";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Missing #root element");
}

render(() => <App />, rootElement);
