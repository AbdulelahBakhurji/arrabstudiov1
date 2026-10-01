import { describe, expect, it } from "vitest";
import { extractGeneratedImage } from "./image-service.js";

describe("extractGeneratedImage", () => {
  it("reads a Gemini image part", () => {
    const found = extractGeneratedImage({
      choices: [
        {
          message: {
            images: [
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,aGVsbG8=" },
              },
            ],
          },
        },
      ],
    });
    expect(found).toEqual({ mime: "image/png", base64: "aGVsbG8=" });
  });

  it("returns null when the model only sent text", () => {
    expect(extractGeneratedImage({ choices: [{ message: { content: "a cat" } }] })).toBeNull();
  });
});
