import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CharCounter } from "./CharCounter";

describe("CharCounter", () => {
  it("renders the entered length over the limit", () => {
    const markup = renderToStaticMarkup(<CharCounter value="abc" max={100} />);
    expect(markup).toContain("3 / 100");
  });

  it("marks over-limit state for styling", () => {
    const ok = renderToStaticMarkup(<CharCounter value="abc" max={5} />);
    const over = renderToStaticMarkup(<CharCounter value="abcdef" max={5} />);
    expect(over).toContain('data-over="true"');
    expect(ok).not.toContain("data-over=");
  });
});
