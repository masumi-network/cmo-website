import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalCard, WeeklyNote } from "@/components/cards";
import { AskBar } from "@/components/ask-bar";
import { BrandForm } from "@/components/brand-form";
import { Hud } from "@/components/hud";
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

describe("WeeklyNote", () => {
  it("folds its list on phones until the headline is tapped", async () => {
    render(<WeeklyNote />);
    const toggle = screen.getByRole("button", { name: "Here's what I learned this week." });
    const list = document.getElementById("weekly-items")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(list).toHaveClass("hidden");
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(list).not.toHaveClass("hidden");
  });

  it("agrees to the plan", async () => {
    render(<WeeklyNote />);
    await userEvent.click(screen.getByRole("button", { name: "Sounds good" }));
    expect(screen.getByText("Plan updated for next week")).toBeInTheDocument();
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

  it("tells analytics about the signup when GA is loaded", async () => {
    const gtag = vi.fn();
    vi.stubGlobal("gtag", gtag);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })));
    render(<WaitlistForm />);
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(gtag).toHaveBeenCalledWith("event", "sign_up", { method: "waitlist" });
  });

  it("has a honeypot people cannot see or reach, and sends it only when filled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<WaitlistForm />);
    const trap = container.querySelector<HTMLInputElement>('input[name="nickname"]')!;
    expect(trap).toHaveAttribute("tabindex", "-1");
    expect(trap.closest("[aria-hidden]")).not.toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1); // only Email is exposed

    trap.value = "bot";
    await userEvent.type(screen.getByLabelText("Email"), "a@b.co");
    await userEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "a@b.co", nickname: "bot" });
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

  it("says something new when asked the same thing twice", async () => {
    render(<AskBar onGo={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "seo{Enter}");
    const first = useCity.getState().reply;
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "seo{Enter}");
    expect(useCity.getState().reply).not.toBe(first);
  });

  it("offers things to ask when he does not know, and a chip sends him there", async () => {
    const onGo = vi.fn();
    render(<AskBar onGo={onGo} />);
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "what is the meaning of life{Enter}");
    expect(onGo).not.toHaveBeenCalled();
    const chips = screen.getByRole("group", { name: "Try asking" });
    await userEvent.click(within(chips).getByRole("button", { name: "SEO" }));
    expect(onGo).toHaveBeenCalledWith(chapterIndex("seo"));
    expect(screen.queryByRole("group", { name: "Try asking" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ask Cuso")).toHaveFocus();
  });

  it("hides the chips once you start typing", async () => {
    render(<AskBar onGo={vi.fn()} />);
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "asdfghjkl{Enter}");
    expect(screen.getByRole("group", { name: "Try asking" })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Ask Cuso"), "a");
    expect(screen.queryByRole("group", { name: "Try asking" })).not.toBeInTheDocument();
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

describe("Hud", () => {
  it("has no settings button (its only switch was photo-real, now removed)", () => {
    render(<Hud onGo={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Settings" })).not.toBeInTheDocument();
  });
});
