import { describe, expect, it } from "bun:test";
import { parseIngredient, parseIngredients } from "../parse-ingredient";

// ─────────────────────────────────────────────────────────────────────────────
// HAPPY PATH — cases that already work and must keep working
// ─────────────────────────────────────────────────────────────────────────────

describe("happy path regression", () => {
  it("integer + standard unit + name", () => {
    expect(parseIngredient("2 tablespoons olive oil")).toMatchObject({
      quantity: 2,
      unit: "tablespoons",
      name: "olive oil",
    });
  });

  it("decimal fraction + unit + name", () => {
    expect(parseIngredient("1/4 teaspoon kosher salt")).toMatchObject({
      quantity: 0.25,
      unit: "teaspoon",
      name: "kosher salt",
    });
  });

  it("unicode fraction only", () => {
    expect(parseIngredient("½ tsp ground coriander")).toMatchObject({
      quantity: 0.5,
      unit: "tsp",
      name: "ground coriander",
    });
  });

  it("1/3 cup", () => {
    expect(parseIngredient("1/3 cup tahini")).toMatchObject({
      quantity: 1 / 3,
      unit: "cup",
      name: "tahini",
    });
  });

  it("cloves unit", () => {
    expect(parseIngredient("4 cloves garlic, finely minced")).toMatchObject({
      quantity: 4,
      unit: "cloves",
      name: "garlic",
    });
  });

  it("plain name, no quantity or unit", () => {
    expect(parseIngredient("Salt")).toMatchObject({
      quantity: null,
      unit: null,
      name: "Salt",
    });
  });

  it("strips leading bullet", () => {
    expect(parseIngredient("• 2 cups flour")).toMatchObject({
      quantity: 2,
      unit: "cups",
      name: "flour",
    });
  });

  it("strips leading dash", () => {
    expect(parseIngredient("- 1 tbsp soy sauce")).toMatchObject({
      quantity: 1,
      unit: "tbsp",
      name: "soy sauce",
    });
  });

  it("strips trailing prep note after comma", () => {
    expect(parseIngredient("4 cloves garlic, minced")).toMatchObject({
      quantity: 4,
      unit: "cloves",
      name: "garlic",
    });
  });

  it("raw_string preserved exactly", () => {
    const raw = "2 tablespoons olive oil";
    expect(parseIngredient(raw).raw_string).toBe(raw);
  });

  it("¾ unicode fraction + unit", () => {
    expect(parseIngredient("¾ teaspoon ground cinnamon")).toMatchObject({
      quantity: 0.75,
      unit: "teaspoon",
      name: "ground cinnamon",
    });
  });

  it("⅛ unicode fraction + unit", () => {
    expect(parseIngredient("⅛ teaspoon cayenne pepper")).toMatchObject({
      quantity: 0.125,
      unit: "teaspoon",
      name: "cayenne pepper",
    });
  });

  it("integer range → upper bound", () => {
    expect(parseIngredient("2-3 cups chicken broth")).toMatchObject({
      quantity: 3,
      unit: "cups",
      name: "chicken broth",
    });
  });

  it("can unit", () => {
    expect(parseIngredient("1 can coconut milk (14 oz)")).toMatchObject({
      quantity: 1,
      unit: "can",
      name: "coconut milk",
    });
  });

  it("lb unit", () => {
    expect(parseIngredient("8 oz rice noodles")).toMatchObject({
      quantity: 8,
      unit: "oz",
      name: "rice noodles",
    });
  });

  it("ascii mixed number 1 1/2", () => {
    expect(parseIngredient("1 1/2 cups shredded cheese")).toMatchObject({
      quantity: 1.5,
      unit: "cups",
      name: "shredded cheese",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Mixed number with unicode fraction  (e.g. "1 ½")
// ─────────────────────────────────────────────────────────────────────────────

describe("mixed number with unicode fraction", () => {
  it("1 ½ tsp ground cumin", () => {
    expect(parseIngredient("1 ½ tsp ground cumin")).toMatchObject({
      quantity: 1.5,
      unit: "tsp",
      name: "ground cumin",
    });
  });

  it("1 ½ tsp smoked paprika", () => {
    expect(parseIngredient("1 ½ tsp smoked paprika")).toMatchObject({
      quantity: 1.5,
      unit: "tsp",
      name: "smoked paprika",
    });
  });

  it("1 ¼ cups flour", () => {
    expect(parseIngredient("1 ¼ cups flour")).toMatchObject({
      quantity: 1.25,
      unit: "cups",
      name: "flour",
    });
  });

  it("2 ½ tablespoons butter", () => {
    expect(parseIngredient("2 ½ tablespoons butter")).toMatchObject({
      quantity: 2.5,
      unit: "tablespoons",
      name: "butter",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Dash-notation mixed numbers  (e.g. "1-1/2")
// ─────────────────────────────────────────────────────────────────────────────

describe("dash-notation mixed numbers", () => {
  it("1-1/2 cups shredded cabbage", () => {
    expect(parseIngredient("1-1/2 cups shredded green or purple cabbage")).toMatchObject({
      quantity: 1.5,
      unit: "cups",
      name: "shredded green or purple cabbage",
    });
  });

  it("2-1/2 cups broth", () => {
    expect(parseIngredient("2-1/2 cups chicken broth")).toMatchObject({
      quantity: 2.5,
      unit: "cups",
      name: "chicken broth",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Fractional ranges  (e.g. "1/2-1")
// ─────────────────────────────────────────────────────────────────────────────

describe("fractional ranges → upper bound", () => {
  it("1/2-1 teaspoon red pepper flakes", () => {
    expect(parseIngredient("1/2-1 teaspoon red pepper flakes")).toMatchObject({
      quantity: 1,
      unit: "teaspoon",
      name: "red pepper flakes",
    });
  });

  it("1/4-1/2 cup olive oil", () => {
    expect(parseIngredient("1/4-1/2 cup olive oil")).toMatchObject({
      quantity: 0.5,
      unit: "cup",
      name: "olive oil",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Em dash / en dash inline descriptions
// ─────────────────────────────────────────────────────────────────────────────

describe("em dash descriptions stripped", () => {
  it("soy sauce – description", () => {
    expect(parseIngredient("1 tablespoon soy sauce – Adds umami and saltiness.")).toMatchObject({
      quantity: 1,
      unit: "tablespoon",
      name: "soy sauce",
    });
  });

  it("sesame oil – description", () => {
    expect(parseIngredient("1 tablespoon sesame oil – For that signature toasted flavor.")).toMatchObject({
      quantity: 1,
      unit: "tablespoon",
      name: "sesame oil",
    });
  });

  it("ground pork – long description", () => {
    expect(parseIngredient(
      "1 lb ground pork – The classic meat used in most egg roll filling recipes; it adds a rich (savory depth.)"
    )).toMatchObject({
      quantity: 1,
      unit: "lb",
      name: "ground pork",
    });
  });

  it("shredded carrots – description", () => {
    expect(parseIngredient("1 cup shredded carrots – Adds sweetness and color.")).toMatchObject({
      quantity: 1,
      unit: "cup",
      name: "shredded carrots",
    });
  });

  it("rice vinegar – description", () => {
    expect(parseIngredient("1 tablespoon rice vinegar – A little acid for balance.")).toMatchObject({
      quantity: 1,
      unit: "tablespoon",
      name: "rice vinegar",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Parenthetical size stripping
// ─────────────────────────────────────────────────────────────────────────────

describe("parenthetical size stripping", () => {
  it("(13.5-ounce/400 ml) can full-fat coconut milk", () => {
    expect(parseIngredient("1 (13.5-ounce/400 ml) can full-fat coconut milk")).toMatchObject({
      quantity: 1,
      unit: "can",
      name: "full-fat coconut milk",
    });
  });

  it("(14-ounce/400g) can crushed tomatoes", () => {
    expect(parseIngredient("1 (14-ounce/400g) can crushed tomatoes")).toMatchObject({
      quantity: 1,
      unit: "can",
      name: "crushed tomatoes",
    });
  });

  it("(~190g) red lentils", () => {
    expect(parseIngredient("1 cup (~190g) red lentils")).toMatchObject({
      quantity: 1,
      unit: "cup",
      name: "red lentils",
    });
  });

  it("14-oz can chickpeas inline", () => {
    // "1 14-oz can chickpeas, drained & rinsed"
    expect(parseIngredient("1 14-oz can chickpeas, drained & rinsed")).toMatchObject({
      quantity: 1,
      unit: "can",
      name: "chickpeas",
    });
  });

  it("(low sodium if preferred) stripped from name", () => {
    // This is a non-size parenthetical — name should keep "chicken broth" without the paren
    expect(parseIngredient("6 cups chicken broth (low sodium if preferred)")).toMatchObject({
      quantity: 6,
      unit: "cups",
      name: "chicken broth",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Parenthetical prep notes left in name
// ─────────────────────────────────────────────────────────────────────────────

describe("parenthetical prep notes stripped from name", () => {
  it("medium onion (diced)", () => {
    expect(parseIngredient("1 medium onion (diced)")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "medium onion",
    });
  });

  it("garlic (minced)", () => {
    expect(parseIngredient("2 cloves garlic (minced)")).toMatchObject({
      quantity: 2,
      unit: "cloves",
      name: "garlic",
    });
  });

  it("fresh ginger (grated – description)", () => {
    expect(parseIngredient("2 tablespoons fresh ginger (grated – Bright, spicy, and warming.)")).toMatchObject({
      quantity: 2,
      unit: "tablespoons",
      name: "fresh ginger",
    });
  });

  it("green cabbage (thinly sliced – description)", () => {
    expect(parseIngredient("4 cups green cabbage (thinly sliced – Replicates that crisp egg roll texture.)")).toMatchObject({
      quantity: 4,
      unit: "cups",
      name: "green cabbage",
    });
  });

  it("fresh cilantro (for garnish) → name only, no filter", () => {
    // Proposed: keep as ingredient, strip the parenthetical
    expect(parseIngredient("fresh cilantro (for garnish)")).toMatchObject({
      quantity: null,
      unit: null,
      name: "fresh cilantro",
    });
  });

  it("pepper (to taste)", () => {
    expect(parseIngredient("pepper (to taste)")).toMatchObject({
      quantity: null,
      unit: null,
      name: "pepper",
    });
  });

  it("basil pesto (store-bought or homemade) — non-prep paren kept", () => {
    // "store-bought or homemade" is not a prep note — name should be "basil pesto"
    // since we're stripping all parens from names, this becomes "basil pesto"
    expect(parseIngredient("1/3 cup basil pesto (store-bought or homemade)")).toMatchObject({
      quantity: 1 / 3,
      unit: "cup",
      name: "basil pesto",
    });
  });

  it("lime juice (freshly squeezed) stripped", () => {
    expect(parseIngredient("2 tablespoons lime juice  (freshly squeezed)")).toMatchObject({
      quantity: 2,
      unit: "tablespoons",
      name: "lime juice",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Prep note / qualifier stripping expansion
// ─────────────────────────────────────────────────────────────────────────────

describe("prep note / qualifier stripping", () => {
  it("water, as needed → water", () => {
    expect(parseIngredient("water, as needed")).toMatchObject({
      quantity: null,
      unit: null,
      name: "water",
    });
  });

  it("kosher salt, use more as needed", () => {
    expect(parseIngredient("1 tsp kosher salt, use more as needed")).toMatchObject({
      quantity: 1,
      unit: "tsp",
      name: "kosher salt",
    });
  });

  it("lemon, juiced", () => {
    expect(parseIngredient("1/2 lemon, juiced")).toMatchObject({
      quantity: 0.5,
      unit: null,
      name: "lemon",
    });
  });

  it("small carrots, julienned", () => {
    expect(parseIngredient("2 small carrots, julienned")).toMatchObject({
      quantity: 2,
      unit: null,
      name: "small carrots",
    });
  });

  it("small cucumber, julienned", () => {
    expect(parseIngredient("1 small cucumber, julienned")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "small cucumber",
    });
  });

  it("serrano peppers, finely minced with asterisk", () => {
    expect(parseIngredient("2 serrano peppers, finely minced*")).toMatchObject({
      quantity: 2,
      unit: null,
      name: "serrano peppers",
    });
  });

  it("small head cauliflower, chopped into bite-sized florets", () => {
    expect(parseIngredient("1 small head cauliflower, chopped into bite-sized florets")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "small head cauliflower",
    });
  });

  it("sweet potato, diced into 1/2-inch cubes", () => {
    expect(parseIngredient("1 sweet potato, diced into 1/2-inch cubes")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "sweet potato",
    });
  });

  it("pure maple syrup or honey — 'or' alternatives kept in name", () => {
    expect(parseIngredient("2 tablespoons pure maple syrup or honey")).toMatchObject({
      quantity: 2,
      unit: "tablespoons",
      name: "pure maple syrup or honey",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: Trailing footnote markers
// ─────────────────────────────────────────────────────────────────────────────

describe("trailing footnote markers stripped", () => {
  it("cayenne pepper**", () => {
    expect(parseIngredient("1 tsp cayenne pepper**")).toMatchObject({
      quantity: 1,
      unit: "tsp",
      name: "cayenne pepper",
    });
  });

  it("serrano peppers*", () => {
    expect(parseIngredient("2 serrano peppers*")).toMatchObject({
      quantity: 2,
      unit: null,
      name: "serrano peppers",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG: "to taste" prefix
// ─────────────────────────────────────────────────────────────────────────────

describe("'for serving:' prefix handling", () => {
  it("for serving: quinoa → quinoa", () => {
    expect(parseIngredient(
      "for serving: quinoa, shredded cabbage or lettuce, thinly sliced cucumber, etc."
    )).toMatchObject({
      quantity: null,
      unit: null,
      name: "quinoa",
    });
  });
});

describe("'to taste' prefix handling", () => {
  it("to taste   salt", () => {
    // Inverted order from some scrapers — proposed: name: "salt", qty: null
    expect(parseIngredient("to taste   salt")).toMatchObject({
      quantity: null,
      unit: null,
      name: "salt",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Filter cases (parseIngredients)
// ─────────────────────────────────────────────────────────────────────────────

describe("parseIngredients — filter cases", () => {
  it("filters 'for serving:' lines", () => {
    const results = parseIngredients([
      "2 cups rice",
      "for serving: quinoa, shredded cabbage or lettuce, thinly sliced cucumber, thinly sliced red onions, tahini sauce (below), etc.",
      "1 tbsp olive oil",
    ]);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.name)).toEqual(["rice", "olive oil"]);
  });

  it("filters section headers ending in ':'", () => {
    const results = parseIngredients([
      "For The Sauce:",
      "2 tbsp soy sauce",
      "1 tsp sesame oil",
    ]);
    expect(results).toHaveLength(2);
  });

  it("expands 'salt and pepper' into two ingredients", () => {
    const results = parseIngredients(["salt and pepper"]);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("salt");
    expect(results[1].name).toBe("pepper");
  });

  it("does not expand 'avocado oil or olive oil' (has digit)", () => {
    // "4 tbsp avocado oil or olive oil" — the "or" is an alternative, not compound
    // expandCompound only splits purely alphabetic sides with no digits before "and"
    const results = parseIngredients(["4 tbsp avocado oil or olive oil"]);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("avocado oil or olive oil");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional real DB cases
// ─────────────────────────────────────────────────────────────────────────────

describe("additional real scraped cases", () => {
  it("green onions (chopped (divided) – description)", () => {
    expect(parseIngredient(
      "1/2 cup green onions (chopped (divided) – Some for cooking, some for garnish.)"
    )).toMatchObject({
      quantity: 0.5,
      unit: "cup",
      name: "green onions",
    });
  });

  it("beaten eggs – description", () => {
    expect(parseIngredient(
      "2 beaten eggs – For a nod to eggdrop soup recipes (you can swirl these in at the end for extra richness.)"
    )).toMatchObject({
      quantity: 2,
      unit: null,
      name: "eggs",
    });
  });

  it("Red pepper flakes or sriracha – description (no qty)", () => {
    const results = parseIngredients([
      "Red pepper flakes or sriracha – If you want to add some heat."
    ])
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("red pepper flakes");
    expect(results[1].name).toBe("sriracha");
  });

  it("chicken broth (low sodium if preferred) — 6 cups", () => {
    expect(parseIngredient("6 cups chicken broth (low sodium if preferred)")).toMatchObject({
      quantity: 6,
      unit: "cups",
      name: "chicken broth",
    });
  });

  it("4 slices bacon (cooked and sliced)", () => {
    expect(parseIngredient("4 slices bacon (cooked and sliced)")).toMatchObject({
      quantity: 4,
      unit: "slices",
      name: "bacon",
    });
  });

  it("1 red bell pepper (diced) — double space", () => {
    expect(parseIngredient("1  red bell pepper ( diced)")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "red bell pepper",
    });
  });

  it("1 medium sweet pepper, julienned", () => {
    expect(parseIngredient("1 medium sweet pepper, julienned")).toMatchObject({
      quantity: 1,
      unit: null,
      name: "medium sweet pepper",
    });
  });

  it("3 tablespoons minced fresh ginger", () => {
    // prep word "minced" is at the start — should remain in name
    expect(parseIngredient("3 tablespoons minced fresh ginger")).toMatchObject({
      quantity: 3,
      unit: "tablespoons",
      name: "fresh ginger",
    });
  });

  it("fresh cilantro ( chopped) — space inside paren", () => {
    expect(parseIngredient("fresh cilantro ( chopped)")).toMatchObject({
      quantity: null,
      unit: null,
      name: "fresh cilantro",
    });
  });

  it("2 inch piece of fresh ginger, finely minced", () => {
    // "inch" is not a unit — name should be "inch piece of fresh ginger" or "fresh ginger"
    // Proposed: keep as-is since "inch" has no clean handling
    expect(parseIngredient("2 inch piece of fresh ginger, finely minced")).toMatchObject({
      quantity: 2,
      unit: null,
      name: "fresh ginger",
    });
  });

  it("salt and pepper ( to taste) expands to two", () => {
    const results = parseIngredients(["salt and pepper ( to taste)"]);
    expect(results).toHaveLength(2);
    expect(results[0].name).toBe("salt");
    expect(results[1].name).toBe("pepper");
  });
});
