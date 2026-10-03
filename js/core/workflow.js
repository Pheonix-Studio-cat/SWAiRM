// Workflow graph: which agent waits for which.
//
// Dependencies come from the roles (`after`), restricted to the roles that are
// actually in the team. Roles that depend on nobody present start right after
// the Planner (or immediately, without one) — that is where parallel work
// comes from. The Reviewer waits for every agent nobody else waits for.

import { getRole } from './roles.js';

/**
 * @param {string[]} roleIds  one entry per agent, unique
 * @returns {{ nodes: {id:string, deps:string[], level:number}[], sinks:string[], finalId:string|null, levels:number }}
 */
export function buildGraph(roleIds) {
  const ids = [...new Set(roleIds)];
  const present = new Set(ids);
  const deps = new Map();

  for (const id of ids) {
    if (id === 'reviewer' || id === 'planner') continue;
    const d = getRole(id).after.filter((a) => present.has(a) && a !== id);
    deps.set(id, d.length ? d : (present.has('planner') ? ['planner'] : []));
  }
  if (present.has('planner')) deps.set('planner', []);

  // Break cycles defensively: an edge that would close a loop is dropped.
  // (The role table has none today; a user-edited team must not hang a run.)
  const order = [];
  const state = new Map();
  const visit = (id) => {
    if (state.get(id) === 2) return;
    state.set(id, 1);
    deps.set(id, (deps.get(id) ?? []).filter((d) => {
      if (state.get(d) === 1) return false;
      visit(d);
      return true;
    }));
    state.set(id, 2);
    order.push(id);
  };
  [...deps.keys()].forEach(visit);

  const dependents = new Set([...deps.values()].flat());
  const sinks = order.filter((id) => !dependents.has(id));

  if (present.has('reviewer')) {
    deps.set('reviewer', sinks.length ? sinks : []);
    order.push('reviewer');
  }

  const level = new Map();
  for (const id of order) {
    const ds = deps.get(id) ?? [];
    level.set(id, ds.length ? Math.max(...ds.map((d) => level.get(d))) + 1 : 0);
  }

  const nodes = order.map((id) => ({ id, deps: deps.get(id) ?? [], level: level.get(id) }));
  const finalId = present.has('reviewer') ? 'reviewer' : (sinks.length === 1 ? sinks[0] : null);
  const levels = nodes.length ? Math.max(...nodes.map((n) => n.level)) + 1 : 0;
  return { nodes, sinks: present.has('reviewer') ? ['reviewer'] : sinks, finalId, levels };
}
