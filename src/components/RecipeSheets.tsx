import { useState, type FormEvent } from 'react';
import { Icon, Sheet } from './ui';
import * as api from '../lib/api';
import { errorMessage } from '../lib/storage';
import type { Recipe } from '../lib/types';

/** Only allow http(s) links to be rendered as clickable. */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function RecipeViewSheet(props: {
  recipe: Recipe;
  onClose: () => void;
  onEdit: () => void;
  onAddToList: (items: string[]) => Promise<void>;
}) {
  const { recipe } = props;
  const [picked, setPicked] = useState<Set<number>>(() => new Set(recipe.ingredients.map((_, i) => i)));
  const [busy, setBusy] = useState(false);
  const link = safeUrl(recipe.source_url);

  const toggle = (i: number) => setPicked((p) => {
    const next = new Set(p);
    if (next.has(i)) next.delete(i);
    else next.add(i);
    return next;
  });

  async function addToList() {
    setBusy(true);
    await props.onAddToList(recipe.ingredients.filter((_, i) => picked.has(i)));
    setBusy(false);
  }

  return (
    <Sheet title={recipe.title} onClose={props.onClose}>
      <div className="recipe-view">
        <div className="detail-meta">
          {recipe.servings && <span className="muted">{recipe.servings}</span>}
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="source-link">
              <Icon name="link" size={16} /> {new URL(link).hostname.replace(/^www\./, '')}
            </a>
          )}
        </div>

        {recipe.ingredients.length > 0 && (
          <section>
            <h3 className="section-title">Ingredients</h3>
            <ul className="ingredient-list">
              {recipe.ingredients.map((ing, i) => (
                <li key={i}>
                  <label>
                    <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                    <span>{ing}</span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="btn primary full" disabled={busy || picked.size === 0} onClick={addToList}>
              <Icon name="cart" size={18} /> Add {picked.size} to shopping list
            </button>
          </section>
        )}

        {recipe.steps && (
          <section>
            <h3 className="section-title">Steps</h3>
            <div className="recipe-steps">{recipe.steps}</div>
          </section>
        )}

        {recipe.notes && (
          <section>
            <h3 className="section-title">Notes</h3>
            <div className="recipe-steps">{recipe.notes}</div>
          </section>
        )}

        <div className="form-actions">
          <button className="btn" onClick={props.onEdit}>Edit recipe</button>
        </div>
      </div>
    </Sheet>
  );
}

export function RecipeEditSheet(props: {
  recipe: Recipe | null;
  /** Pre-filled values, e.g. from a website import. */
  draft?: api.RecipeFields;
  householdId: string;
  meId: string;
  onClose: () => void;
  onSaved: (id: string | null) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const start = props.recipe ?? props.draft;
  const [title, setTitle] = useState(start?.title ?? '');
  const [servings, setServings] = useState(start?.servings ?? '');
  const [ingredients, setIngredients] = useState((start?.ingredients ?? []).join('\n'));
  const [steps, setSteps] = useState(start?.steps ?? '');
  const [notes, setNotes] = useState(start?.notes ?? '');
  const [source, setSource] = useState(start?.source_url ?? '');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const fields: api.RecipeFields = {
      title: title.trim().slice(0, 120),
      servings: servings.trim().slice(0, 40) || null,
      ingredients: ingredients.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.slice(0, 300)),
      steps: steps.trim() || null,
      notes: notes.trim() || null,
      source_url: source.trim() || null,
    };
    setBusy(true);
    try {
      if (props.recipe) {
        await api.saveRecipe(props.recipe.id, fields);
        props.notify('Recipe saved');
        props.onSaved(props.recipe.id);
      } else {
        const created = await api.addRecipe(props.householdId, fields, props.meId);
        props.notify('Recipe added');
        props.onSaved(created.id);
      }
    } catch (err) {
      props.notify(errorMessage(err), true);
      setBusy(false);
    }
  }

  async function remove() {
    if (!props.recipe || !confirm(`Delete the recipe "${props.recipe.title}"?`)) return;
    setBusy(true);
    try {
      await api.deleteRecipe(props.recipe.id);
      props.notify('Recipe deleted');
      props.onSaved(null);
    } catch (err) {
      props.notify(errorMessage(err), true);
      setBusy(false);
    }
  }

  return (
    <Sheet title={props.recipe ? 'Edit recipe' : 'New recipe'} onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Title
          <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} autoFocus={!start} />
        </label>
        <label>
          <span>Servings <span className="muted">(optional)</span></span>
          <input value={servings} maxLength={40} placeholder="e.g. 4 servings" onChange={(e) => setServings(e.target.value)} />
        </label>
        <label>
          <span>Ingredients <span className="muted">(one per line)</span></span>
          <textarea rows={7} value={ingredients} onChange={(e) => setIngredients(e.target.value)}
            placeholder={'2 cups flour\n1 tsp salt'} />
        </label>
        <label>
          Steps
          <textarea rows={7} value={steps} maxLength={20000} onChange={(e) => setSteps(e.target.value)} />
        </label>
        <label>
          <span>Notes <span className="muted">(optional)</span></span>
          <textarea rows={2} value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <label>
          <span>Source link <span className="muted">(optional)</span></span>
          <input type="url" value={source} maxLength={2000} placeholder="https://" onChange={(e) => setSource(e.target.value)} />
        </label>
        <div className="form-actions">
          {props.recipe && <button type="button" className="btn danger-text" disabled={busy} onClick={remove}>Delete</button>}
          <button type="submit" className="btn primary" disabled={busy || !title.trim()}>Save</button>
        </div>
      </form>
    </Sheet>
  );
}

export function RecipeImportSheet(props: {
  onClose: () => void;
  onImported: (draft: api.RecipeFields) => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!safeUrl(url.trim())) {
      setError('Paste a full web address starting with https://');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      props.onImported(await api.importRecipe(url.trim()));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="Import a recipe" onClose={props.onClose}>
      <form className="form" onSubmit={submit}>
        <label>
          Recipe web page
          <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" autoFocus />
          <span className="hint">Works with most recipe sites. You can review and edit everything before saving.</span>
        </label>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="form-actions">
          <button type="submit" className="btn primary" disabled={busy || !url.trim()}>
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}
