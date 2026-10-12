import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard } from "@/components/cards";
import { AskBar } from "@/components/ask-bar";
import { BrandForm } from "@/components/brand-form";
import { WaitlistForm } from "@/components/waitlist-form";
import { chapterIndex } from "@/content/day";
import { initialCity, useCity } from "@/lib/store";

beforeEach(() => useCity.setState(initialCity));
afterEach(() => vi.unstubAllGlobals());

describe("ApprovalCard", () => {
  it("schedules the draft on Approve and can undo", async () => {
    render(<ApprovalCard />);
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(screen.getByText("Scheduled for Tue 09:00")).toBeInTheDocument();
    expect(useCity.getState().approved).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });
});

describe("WaitlistForm", () => {
  it("shows the email error without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm />);
    await userEvent.type(screen.getByLabelText("Email"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Please enter a valid email.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts a valid signup and confirms", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<WaitlistForm withWebsite />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.type(screen.getByLabelText("Website (optional)"), "b.co");
    await userEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("You're on the list"));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "a@b.co", website: "b.co" });
  });

  it("shows the server's error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Server says no." }), { status: 400 })));
    render(<WaitlistForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server says no."));
  });
});

describe("AskBar", () => {
  it("answers and sends Cuso to the right place", async () => {
    const onGo = vi.fn();
    render(<AskBar onGo={onGo} />);
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "Can you run my ads?{Enter}");
    expect(onGo).toHaveBeenCalledWith(chapterIndex("ads"));
    expect(useCity.getState().reply).toMatch(/Union Square/);
    expect(screen.getByLabelText("Ask Cuso")).toHaveValue("");
  });
});

describe("BrandForm", () => {
  it("puts a valid website on the city signs", async () => {
    render(<BrandForm />);
    const input = screen.getByLabelText("Your website");
    await userEvent.clear(input);
    await userEvent.type(input, "acme.io");
    await userEvent.click(screen.getByRole("button", { name: "Learn my brand" }));
    expect(useCity.getState().website).toBe("acme.io");
  });

  it("rejects something that is not a website", async () => {
    render(<BrandForm />);
    const input = screen.getByLabelText("Your website");
    await userEvent.clear(input);
    await userEvent.type(input, "hello");
    await userEvent.click(screen.getByRole("button", { name: "Learn my brand" }));
    expect(screen.getByRole("alert")).toHaveTextContent("That doesn't look like a website.");
    expect(useCity.getState().website).toBe(initialCity.website);
  });
});
