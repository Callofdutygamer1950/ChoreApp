import { useMemo, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import * as api from '../lib/api';
import { errorMessage, getItem, setItem, uuid } from '../lib/storage';
import type { Member, Recipe, ShoppingItem } from '../lib/types';
import { Icon } from '../components/ui';
import { RecipeEditSheet, RecipeImportSheet, RecipeViewSheet } from '../components/RecipeSheets';

type View = 'shopping' | 'recipes';
type RecipeSheet =
  | { kind: 'view'; id: string }
  | { kind: 'edit'; recipe: Recipe | null; draft?: api.RecipeFields }
  | { kind: 'import' };

const VIEW_KEY = 'chores.kitchenView';

export function KitchenTab(props: {
  householdId: string;
  shopping: ShoppingItem[];
  setShopping: Dispatch<SetStateAction<ShoppingItem[]>>;
  recipes: Recipe[];
  members: Member[];
  meId: string;
  reload: () => void;
  notify: (text: string, error?: boolean) => void;
}) {
  const [view, setViewState] = useState<View>(() => (getItem(VIEW_KEY) === 'recipes' ? 'recipes' : 'shopping'));
  const setView = (v: View) => {
    setViewState(v);
    setItem(VIEW_KEY, v);
  };

  return (
    <div className="kitchen">
      <div className="segmented" role="tablist">
        <button role="tab" aria-selected={view === 'shopping'} className={view === 'shopping' ? 'on' : ''}
          onClick={() => setView('shopping')}>
          Shopping{props.shopping.some((i) => !i.done) && <span className="seg-count">{props.shopping.filter((i) => !i.done).length}</span>}
        </button>
        <button role="tab" aria-selected={view === 'recipes'} className={view === 'recipes' ? 'on' : ''}
          onClick={() => setView('recipes')}>Recipes</button>
      </div>
      {view === 'shopping' ? <Shopping {...props} /> : <Recipes {...props} onAddedToList={() => setView('shopping')} />}
    </div>
  );
}

function Shopping(props: Parameters<typeof KitchenTab>[0]) {
  const [text, setText] = useState('');
  const names = new Map(props.members.map((m) => [m.id, m.name]));
  const toBuy = props.shopping.filter((i) => !i.done);
  const bought = props.shopping
    .filter((i) => i.done)
    .sort((a, b) => (b.done_at ?? '').localeCompare(a.done_at ?? ''));

  async function change(optimistic: (items: ShoppingItem[]) => ShoppingItem[], action: () => Promise<void>) {
    props.setShopping(optimistic);
    try {
      await action();
    } catch (e) {
      props.notify(errorMessage(e), true);
      props.reload();
    }
  }

  function add(e: FormEvent) {
    e.preventDefault();
    const name = text.trim().slice(0, 120);
    if (!name) return;
    setText('');
    const item: ShoppingItem = {
      id: uuid(), household_id: props.householdId, name, done: false, added_by: props.meId,
      created_at: new Date().toISOString(), done_at: null,
    };
    change((items) => [...items, item], () => api.addShoppingItem({ id: item.id, household_id: item.household_id, name, added_by: props.meId }));
  }

  const toggle = (item: ShoppingItem) => change(
    (items) => items.map((i) => (i.id === item.id ? { ...i, done: !i.done, done_at: i.done ? null : new Date().toISOString() } : i)),
    () => api.setShoppingDone(item.id, !item.done),
  );
  const remove = (item: ShoppingItem) => change(
    (items) => items.filter((i) => i.id !== item.id),
    () => api.deleteShoppingItem(item.id),
  );
  const clear = () => change((items) => items.filter((i) => !i.done), () => api.clearBought(props.householdId));

  const row = (item: ShoppingItem) => (
    <li key={item.id} className={`shop-item${item.done ? ' done' : ''}`}>
      <button className="check" onClick={() => toggle(item)} aria-pressed={item.done}
        aria-label={item.done ? `Mark ${item.name} not bought` : `Mark ${item.name} bought`}>
        {item.done && <Icon name="check" size={16} />}
      </button>
      <span className="shop-name">
        {item.name}
        {!item.done && item.added_by && item.added_by !== props.meId && (
          <span className="shop-by">{names.get(item.added_by)}</span>
        )}
      </span>
      <button className="icon-btn" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>
        <Icon name="close" size={18} />
      </button>
    </li>
  );

  return (
    <div className="shopping">
      <form className="add-row" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Add an item, e.g. Trash bags"
          maxLength={120} aria-label="New shopping item" enterKeyHint="done" />
        <button className="btn primary" disabled={!text.trim()} aria-label="Add item"><Icon name="plus" size={20} /></button>
      </form>

      {toBuy.length === 0 && <p className="empty-small muted">Nothing to buy.</p>}
      <ul className="shop-list card">{toBuy.map(row)}</ul>

      {bought.length > 0 && (
        <section>
          <div className="section-row">
            <h3 className="section-title">Bought</h3>
            <button className="btn small" onClick={clear}>Clear bought</button>
          </div>
          <ul className="shop-list card">{bought.map(row)}</ul>
        </section>
      )}
    </div>
  );
}

function Recipes(props: Parameters<typeof KitchenTab>[0] & { onAddedToList: () => void }) {
  const [sheet, setSheet] = useState<RecipeSheet | null>(null);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...props.recipes].sort((a, b) => a.title.localeCompare(b.title));
    return q ? sorted.filter((r) => r.title.toLowerCase().includes(q) || r.ingredients.some((i) => i.toLowerCase().includes(q))) : sorted;
  }, [props.recipes, query]);
  const viewing = sheet?.kind === 'view' ? props.recipes.find((r) => r.id === sheet.id) : null;

  return (
    <div className="recipes">
      <div className="recipe-actions">
        <button className="btn primary" onClick={() => setSheet({ kind: 'edit', recipe: null })}>
          <Icon name="plus" size={18} /> New recipe
        </button>
        <button className="btn" onClick={() => setSheet({ kind: 'import' })}>
          <Icon name="link" size={18} /> Import from website
        </button>
      </div>

      {props.recipes.length > 5 && (
        <input className="search" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search recipes or ingredients" aria-label="Search recipes" />
      )}

      {props.recipes.length === 0 && (
        <p className="empty-small muted">No recipes yet. Add one, or import it from a recipe website.</p>
      )}
      <ul className="recipe-list">
        {list.map((r) => (
          <li key={r.id}>
            <button className="recipe-card" onClick={() => setSheet({ kind: 'view', id: r.id })}>
              <span className="recipe-title">{r.title}</span>
              <span className="muted recipe-sub">
                {[r.servings, r.ingredients.length ? `${r.ingredients.length} ingredients` : null].filter(Boolean).join(' · ')}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {viewing && (
        <RecipeViewSheet recipe={viewing} onClose={() => setSheet(null)}
          onEdit={() => setSheet({ kind: 'edit', recipe: viewing })}
          onAddToList={async (items) => {
            try {
              await api.addShoppingItems(props.householdId, items.map((i) => i.slice(0, 120)), props.meId);
              props.notify(`Added ${items.length} to the shopping list`);
              props.reload();
              setSheet(null);
              props.onAddedToList();
            } catch (e) {
              props.notify(errorMessage(e), true);
            }
          }} />
      )}
      {sheet?.kind === 'edit' && (
        <RecipeEditSheet recipe={sheet.recipe} draft={sheet.draft} householdId={props.householdId} meId={props.meId}
          onClose={() => setSheet(null)} notify={props.notify}
          onSaved={(id) => { props.reload(); setSheet(id ? { kind: 'view', id } : null); }} />
      )}
      {sheet?.kind === 'import' && (
        <RecipeImportSheet onClose={() => setSheet(null)} notify={props.notify}
          onImported={(draft) => setSheet({ kind: 'edit', recipe: null, draft })} />
      )}
    </div>
  );
}
