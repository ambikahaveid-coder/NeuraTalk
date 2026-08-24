import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

describe("frontend test harness smoke test", () => {
  it("renders a basic component", () => {
    render(<div>hello marketing console</div>);
    expect(screen.getByText("hello marketing console")).toBeInTheDocument();
  });
});
