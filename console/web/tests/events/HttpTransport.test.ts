import { describe, expect, it } from "vitest";
import { HttpTransport } from "../../src/events/Transport.js";
import { triviaMatch } from "./fakes.js";

describe("HttpTransport", () => {
  it("POSTs the batch as JSON and treats any status but 2xx as a failure", async () => {
    const requests: { url: string; init: RequestInit | undefined }[] = [];
    let status = 202;
    const transport = new HttpTransport("/api/events", async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(null, { status });
    });
    const { started } = triviaMatch();

    await transport.send([started]);
    expect(requests[0]?.url).toBe("/api/events");
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual([started]);

    status = 503;
    await expect(transport.send([started])).rejects.toThrow(/503/);
  });
});
