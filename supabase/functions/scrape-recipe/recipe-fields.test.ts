import { describe, expect, it } from "bun:test";
import { decodeHtmlEntities, extractIngredients, extractInstructions } from "./recipe-fields";

describe("decodeHtmlEntities", () => {
  it("decodes decimal and hexadecimal Unicode entities", () => {
    expect(decodeHtmlEntities("It doesn&#x27;t change &#39;plain text&#39; &#x1F383;"))
      .toBe("It doesn't change 'plain text' 🎃");
  });

  it("preserves invalid Unicode numeric entities", () => {
    expect(decodeHtmlEntities("&#0; &#xD800; &#x110000;"))
      .toBe("&#0; &#xD800; &#x110000;");
  });

  it("returns markup-looking input as an inert string", () => {
    expect(decodeHtmlEntities("&lt;img src=x onerror=alert(1)&gt;"))
      .toBe("<img src=x onerror=alert(1)>");
  });
});

describe("extractInstructions", () => {
  it("preserves named HowToSection groups in source order", () => {
    expect(extractInstructions([
      { "@type": "HowToStep", text: "Preheat the oven." },
      {
        "@type": "HowToSection",
        name: "Make the streusel:",
        itemListElement: [
          { "@type": "HowToStep", text: "Combine the streusel ingredients." },
        ],
      },
      {
        "@type": "HowToSection",
        name: "Make the cake:",
        itemListElement: [
          { "@type": "HowToStep", text: "Mix the batter." },
          { "@type": "HowToStep", text: "Bake until done." },
        ],
      },
    ])).toEqual([
      "Preheat the oven.",
      {
        type: "section",
        title: "Make the streusel:",
        steps: ["Combine the streusel ingredients."],
      },
      {
        type: "section",
        title: "Make the cake:",
        steps: ["Mix the batter.", "Bake until done."],
      },
    ]);
  });

  it("decodes section titles and steps without evaluating markup", () => {
    expect(extractInstructions([{
      "@type": "HowToSection",
      name: "Cook &amp; finish",
      itemListElement: [{
        "@type": "HowToStep",
        text: "Add &lt;script&gt;alert(1)&lt;/script&gt; &amp; serve.",
      }],
    }])).toEqual([{
      type: "section",
      title: "Cook & finish",
      steps: ["Add <script>alert(1)</script> & serve."],
    }]);
  });

  it("flattens nameless sections and ignores empty named sections", () => {
    expect(extractInstructions([
      {
        "@type": "HowToSection",
        itemListElement: [{ "@type": "HowToStep", text: "Keep this step." }],
      },
      { "@type": "HowToSection", name: "Empty", itemListElement: [] },
    ])).toEqual(["Keep this step."]);
  });
});

describe("extractIngredients", () => {
  it("preserves repeated ingredients in their source order", () => {
    const brownSugar = "1/2 cup (100 grams) light brown sugar";

    expect(extractIngredients([
      brownSugar,
      "2 cups (254 grams) all-purpose flour",
      brownSugar,
    ])).toEqual([
      brownSugar,
      "2 cups (254 grams) all-purpose flour",
      brownSugar,
    ]);
  });

  it("decodes entities, trims strings, and ignores non-string entries", () => {
    expect(extractIngredients([" 1 cup macaroni &amp; cheese ", null, 2, ""])).toEqual([
      "1 cup macaroni & cheese",
    ]);
  });

  it("returns an empty list for a non-array value", () => {
    expect(extractIngredients("1 cup flour")).toEqual([]);
  });
});
