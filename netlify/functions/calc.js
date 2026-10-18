const FALLBACKS = {
  'chicken breast': { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
  'white rice': { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
  'brown rice': { calories: 123, protein: 2.6, carbs: 26, fat: 1 },
  'egg': { calories: 155, protein: 13, carbs: 1.1, fat: 11 },
  'whole milk': { calories: 61, protein: 3.2, carbs: 4.8, fat: 3.3 },
  'skimmed milk': { calories: 34, protein: 3.4, carbs: 5, fat: 0.1 },
  'olive oil': { calories: 884, protein: 0, carbs: 0, fat: 100 },
  'butter': { calories: 717, protein: 0.9, carbs: 0.1, fat: 81 },
  'white bread': { calories: 265, protein: 9, carbs: 49, fat: 3.2 },
  'oats': { calories: 389, protein: 16.9, carbs: 66, fat: 6.9 },
  'apple': { calories: 52, protein: 0.3, carbs: 14, fat: 0.2 },
  'banana': { calories: 89, protein: 1.1, carbs: 23, fat: 0.3 },
  'orange': { calories: 47, protein: 0.9, carbs: 12, fat: 0.1 },
  'cucumber': { calories: 15, protein: 0.7, carbs: 3.6, fat: 0.1 },
  'tomato': { calories: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
  'potato': { calories: 77, protein: 2, carbs: 17, fat: 0.1 },
  'sweet potato': { calories: 86, protein: 1.6, carbs: 20, fat: 0.1 },
  'lentils': { calories: 116, protein: 9, carbs: 20, fat: 0.4 },
  'chickpeas': { calories: 164, protein: 8.9, carbs: 27, fat: 2.6 },
  'greek yogurt': { calories: 59, protein: 10, carbs: 3.6, fat: 0.4 },
  'cheddar': { calories: 403, protein: 25, carbs: 1.3, fat: 33 },
  'tuna': { calories: 132, protein: 28, carbs: 0, fat: 1.3 },
  'salmon': { calories: 208, protein: 20, carbs: 0, fat: 13 },
  'dates': { calories: 282, protein: 2.5, carbs: 75, fat: 0.4 },
  'honey': { calories: 304, protein: 0.3, carbs: 82, fat: 0 },
  'sugar': { calories: 387, protein: 0, carbs: 100, fat: 0 },
  'flour': { calories: 364, protein: 10, carbs: 76, fat: 1 },
  'pasta': { calories: 131, protein: 5, carbs: 25, fat: 1.1 },
  'broccoli': { calories: 34, protein: 2.8, carbs: 7, fat: 0.4 },
  'spinach': { calories: 23, protein: 2.9, carbs: 3.6, fat: 0.4 },
};

const LIQUID_KEYWORDS = ['milk', 'water', 'juice', 'oil', 'sauce', 'soup', 'broth', 'drink', 'tea', 'coffee', 'cola', 'beverage', 'yogurt', 'kefir', 'cream'];

function isLiquid(name) {
  const lower = name.toLowerCase();
  return LIQUID_KEYWORDS.some(k => lower.includes(k));
}

function findFallback(name) {
  const lower = name.toLowerCase();
  if (FALLBACKS[lower]) return { key: lower, data: FALLBACKS[lower] };
  for (const key of Object.keys(FALLBACKS)) {
    if (lower.includes(key) || key.includes(lower)) return { key, data: FALLBACKS[key] };
  }
  return null;
}

function parseFoodToken(token) {
  const underscoreIdx = token.lastIndexOf('_');
  const name = token.slice(0, underscoreIdx).replace(/_/g, ' ').trim();
  const amount = parseFloat(token.slice(underscoreIdx + 1)) || 100;
  return { name, amount };
}

async function lookupOpenFoodFacts(name) {
  // ponytail: Open Food Facts retired cgi/search.pl (returns "Page temporarily
  // unavailable"); this is their current replacement, same nutriments field names.
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(name)}&page_size=1&fields=nutriments`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const n = data.hits && data.hits[0] && data.hits[0].nutriments;
  if (!n || n['energy-kcal_100g'] == null) return null;
  return {
    calories: n['energy-kcal_100g'] || 0,
    protein: n['proteins_100g'] || 0,
    carbs: n['carbohydrates_100g'] || 0,
    fat: n['fat_100g'] || 0,
  };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const foodsParam = (event.queryStringParameters || {}).foods || '';
  const tokens = foodsParam.split(',').map(t => t.trim()).filter(Boolean);

  const items = await Promise.all(tokens.map(async (token) => {
    const { name, amount } = parseFoodToken(token);
    const unit = isLiquid(name) ? 'ml' : 'g';

    let per100 = await lookupOpenFoodFacts(name).catch(() => null);
    let source = 'openfoodfacts';
    let fallbackName = null;

    if (!per100) {
      const fb = findFallback(name);
      if (fb) {
        per100 = fb.data;
        source = 'fallback';
        fallbackName = `${fb.key} (generic)`;
      } else {
        per100 = { calories: 0, protein: 0, carbs: 0, fat: 0 };
        source = 'fallback';
        fallbackName = `${name} (unknown)`;
      }
    }

    const factor = amount / 100;
    return {
      name,
      amount,
      unit,
      calories: per100.calories * factor,
      protein: per100.protein * factor,
      carbs: per100.carbs * factor,
      fat: per100.fat * factor,
      source,
      fallback_name: fallbackName,
    };
  }));

  const totals = items.reduce((acc, item) => {
    acc.calories += item.calories;
    acc.protein += item.protein;
    acc.carbs += item.carbs;
    acc.fat += item.fat;
    return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ items, totals }),
  };
};
