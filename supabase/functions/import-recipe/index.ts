// Supabase Edge Function: reads a recipe from a web page.
// Most recipe sites embed a schema.org "Recipe" in JSON-LD (it's what Google uses for recipe
// cards), so this fetches the page and pulls title, servings, ingredients and steps from that.
// Only signed-in app users can call it.

import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MAX_BYTES = 3_000_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/** Blocks obvious local/private addresses so the function can't be used to probe internal networks. */
function isAllowedUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return null;
  if (host.startsWith('[')) return null; // IPv6 literals
  const ip = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ip) {
    const [a, b] = [Number(ip[1]), Number(ip[2])];
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return null;
  }
  return u;
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ') // strip any HTML tags inside the text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

type Node = Record<string, unknown>;

function* walk(value: unknown): Generator<Node> {
  if (Array.isArray(value)) {
    for (const v of value) yield* walk(v);
  } else if (value && typeof value === 'object') {
    const node = value as Node;
    yield node;
    if (node['@graph']) yield* walk(node['@graph']);
  }
}

const isRecipe = (n: Node) => {
  const t = n['@type'];
  return t === 'Recipe' || (Array.isArray(t) && t.includes('Recipe'));
};

function text(v: unknown): string {
  if (typeof v === 'string') return decodeEntities(v);
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object' && 'text' in (v as Node)) return text((v as Node).text);
  if (v && typeof v === 'object' && 'name' in (v as Node)) return text((v as Node).name);
  return '';
}

/** recipeInstructions can be a string, a list of strings/HowToSteps, or HowToSections of steps. */
function instructions(v: unknown): string[] {
  if (typeof v === 'string') {
    return decodeEntities(v.replace(/<\/(p|li|br)>|<br\s*\/?>/gi, '\n'))
      ? v.replace(/<\/(p|li)>|<br\s*\/?>/gi, '\n').split('\n').map(decodeEntities).filter(Boolean)
      : [];
  }
  if (Array.isArray(v)) return v.flatMap(instructions);
  if (v && typeof v === 'object') {
    const n = v as Node;
    if (n.itemListElement) {
      const title = text(n.name);
      const steps = instructions(n.itemListElement);
      return title ? [`${title}:`, ...steps] : steps;
    }
    const t = text(n.text ?? n.name);
    return t ? [t] : [];
  }
  return [];
}

function servings(v: unknown): string | null {
  const first = Array.isArray(v) ? v.find((x) => typeof x === 'string' && /\D/.test(x)) ?? v[0] : v;
  if (typeof first === 'number') return `${first} servings`;
  if (typeof first === 'string') {
    const s = decodeEntities(first);
    return /^\d+$/.test(s) ? `${s} servings` : s.slice(0, 40) || null;
  }
  return null;
}

function extract(html: string, sourceUrl: string) {
  const scripts = html.matchAll(/<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi);
  for (const m of scripts) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].replace(/^\s*<!--|-->\s*$/g, '').replace(/^\s*\/\/<!\[CDATA\[|\/\/\]\]>\s*$/g, '').trim());
    } catch {
      continue;
    }
    for (const node of walk(data)) {
      if (!isRecipe(node)) continue;
      const ingredients = ((node.recipeIngredient ?? node.ingredients ?? []) as unknown[])
        .map(text).filter(Boolean).map((s) => s.slice(0, 300)).slice(0, 100);
      const steps = instructions(node.recipeInstructions)
        .map((s, i, all) => (s.endsWith(':') || all.length === 1 ? s : `${i + 1}. ${s}`));
      return {
        title: (text(node.name) || 'Imported recipe').slice(0, 120),
        servings: servings(node.recipeYield),
        ingredients,
        steps: steps.join('\n\n').slice(0, 20000) || null,
        notes: null,
        source_url: sourceUrl,
      };
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  // Only people signed in to the app may use the importer.
  const authHeader = req.headers.get('Authorization') ?? '';
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: auth } = await sb.auth.getUser(authHeader.replace(/^Bearer\s+/i, ''));
  if (!auth?.user) return json({ error: 'Please open the app and try again.' }, 401);

  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Send a JSON body with a url.' }, 400);
  }
  const target = isAllowedUrl(String(body.url ?? '').trim());
  if (!target) return json({ error: "That doesn't look like a public web address." }, 400);

  let html: string;
  try {
    const res = await fetch(target, {
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ChoresRecipeImport/1.0)',
        Accept: 'text/html,application/xhtml+xml',
      },
    });
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      return json({ error: "This site blocks automatic imports. You can add the recipe by hand with New recipe." }, 422);
    }
    if (!res.ok) return json({ error: `The site answered with an error (${res.status}).` }, 422);
    if (res.url && !isAllowedUrl(res.url)) return json({ error: 'That page redirected somewhere not allowed.' }, 422);
    const reader = res.body?.getReader();
    if (!reader) return json({ error: 'The page was empty.' }, 422);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    html = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  } catch {
    return json({ error: "Couldn't load that page. Check the link and try again." }, 422);
  }

  const recipe = extract(html, target.href);
  if (!recipe) {
    return json({ error: "Couldn't find a recipe on that page. You can still add it by hand." }, 422);
  }
  return json(recipe);
});
